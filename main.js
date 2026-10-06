const { app, BrowserWindow, ipcMain, session, Menu, shell, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { DISCORD_PARTITION } = require('./src/constants');
const TICKER_DATA_PATH = path.join(__dirname, 'data', 'ticker-data.json');
const tickerData = require('./data/ticker-data.json');

app.name = 'TheySay';
if (typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('com.laike9m.theysay');
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// Discord's web client behaves best when it believes it is plain Chrome; the
// default Electron UA makes it try to light up desktop-app-only code paths.
const DISCORD_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Suppress noisy Chromium internal warnings and OS kernel mismatch logs on macOS
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disable-logging');
// Expand Chromium disk and media cache to speed up tweet embeds & static assets
app.commandLine.appendSwitch('disk-cache-size', '524288000'); // 500MB
app.commandLine.appendSwitch('media-cache-size', '268435456'); // 250MB

let mainWindow = null;
let loginWindow = null;
let discordLoginWindow = null;
const activeNotifications = new Set();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 850,
    minHeight: 650,
    title: 'TheySay - Twitter / X 动态网格看板 (GridStack)',
    icon: ICON_PATH,
    webPreferences: {
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');

  // Ensure external links clicked in iframes / embedded widgets open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Ensure Cmd+R / Ctrl+R always reloads the main app window, and Escape closes open popups across frames
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if ((input.meta || input.control) && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        mainWindow.reload();
      } else if (input.key === 'Escape') {
        mainWindow.webContents.send('global-escape');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Check Twitter login status via persist:x_session cookies
ipcMain.handle('check-login-status', async () => {
  try {
    const xSession = session.fromPartition('persist:x_session');
    const cookies = await xSession.cookies.get({ name: 'auth_token' });
    return cookies.length > 0 && !!cookies[0].value;
  } catch (e) {
    return false;
  }
});

// Open dedicated Twitter login window
ipcMain.on('open-login-window', () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 620,
    height: 750,
    title: '登录 Twitter / X',
    icon: ICON_PATH,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      partition: 'persist:x_session',
      backgroundThrottling: false
    }
  });

  loginWindow.loadURL('https://x.com/i/flow/login', {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });

  // Automatically detect successful login
  loginWindow.webContents.on('did-navigate', async (event, url) => {
    if (url.includes('x.com/home') || url === 'https://x.com/' || url === 'https://x.com') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('login-status-changed', { loggedIn: true });
      }
      setTimeout(() => {
        if (loginWindow && !loginWindow.isDestroyed()) {
          loginWindow.close();
        }
      }, 1000);
    }
  });

  loginWindow.on('closed', async () => {
    loginWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const xSession = session.fromPartition('persist:x_session');
      const cookies = await xSession.cookies.get({ name: 'auth_token' });
      const loggedIn = cookies.length > 0 && !!cookies[0].value;
      mainWindow.webContents.send('login-status-changed', { loggedIn });
    }
  });
});

// Open dedicated Discord login window.
// Unlike X, Discord keeps its auth token in localStorage rather than a cookie,
// so the only thing the main process can observe is where the app navigates:
// landing on /channels/... means the session is live.
ipcMain.on('open-discord-login-window', () => {
  if (discordLoginWindow && !discordLoginWindow.isDestroyed()) {
    discordLoginWindow.focus();
    return;
  }

  discordLoginWindow = new BrowserWindow({
    width: 900,
    height: 760,
    title: '登录 Discord',
    icon: ICON_PATH,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      partition: DISCORD_PARTITION,
      backgroundThrottling: false
    }
  });

  discordLoginWindow.loadURL('https://discord.com/login', {
    userAgent: DISCORD_USER_AGENT
  });

  let reportedLoggedIn = false;
  const notifyIfLoggedIn = (url) => {
    if (reportedLoggedIn) return;
    if (url.indexOf('discord.com/channels/') < 0 && url.indexOf('discord.com/app') < 0) return;

    reportedLoggedIn = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('discord-login-status-changed', { loggedIn: true });
    }
    setTimeout(() => {
      if (discordLoginWindow && !discordLoginWindow.isDestroyed()) {
        discordLoginWindow.close();
      }
    }, 1500);
  };

  discordLoginWindow.webContents.on('did-navigate', (event, url) => notifyIfLoggedIn(url));
  // Discord is a SPA: after the login POST it routes client-side, which only
  // surfaces as an in-page navigation.
  discordLoginWindow.webContents.on('did-navigate-in-page', (event, url) => notifyIfLoggedIn(url));

  discordLoginWindow.on('closed', () => {
    discordLoginWindow = null;
    if (mainWindow && !mainWindow.isDestroyed() && reportedLoggedIn) {
      mainWindow.webContents.send('discord-login-status-changed', { loggedIn: true });
    }
  });
});

// Show native OS system notification for unmuted channels
ipcMain.on('show-system-notification', (event, payload = {}) => {
  try {
    if (!Notification.isSupported()) return;
    const { title, subtitle, body, slotIndex } = payload;
    if (!title && !body) return;

    const notif = new Notification({
      title: String(title || 'TheySay'),
      subtitle: subtitle ? String(subtitle) : undefined,
      body: String(body || ''),
      silent: false
    });

    activeNotifications.add(notif);

    notif.on('click', () => {
      activeNotifications.delete(notif);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        if (typeof slotIndex === 'number') {
          mainWindow.webContents.send('notification-clicked', { slotIndex });
        }
      }
    });

    notif.on('close', () => {
      activeNotifications.delete(notif);
    });

    notif.show();
  } catch (err) {
    console.warn('[Notification] Failed to show system notification:', err.message);
  }
});

// Fetch latest US Stock & ETF ticker symbols from live NASDAQ Screener APIs
ipcMain.handle('fetch-online-tickers', async () => {
  try {
    const headers = {
      'User-Agent': DISCORD_USER_AGENT,
      Accept: 'application/json, text/plain, */*'
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const [stocksRes, etfsRes] = await Promise.all([
      fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true', {
        headers,
        signal: controller.signal
      }),
      fetch('https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10000&offset=0&download=true', {
        headers,
        signal: controller.signal
      })
    ]);
    clearTimeout(timeout);

    const stocksJson = await stocksRes.json();
    const etfsJson = await etfsRes.json();
    const stocks = stocksJson?.data?.rows || stocksJson?.data?.table?.rows || [];
    const etfs = etfsJson?.data?.data?.rows || etfsJson?.data?.rows || [];

    const stopwordsSet = new Set(Array.isArray(tickerData.stopwords) ? tickerData.stopwords : []);
    const dictSet = new Set();
    for (const file of ['words', 'web2a', 'propernames', 'connectives']) {
      const dictPath = path.join('/usr/share/dict', file);
      if (fs.existsSync(dictPath)) {
        try {
          const lines = fs.readFileSync(dictPath, 'utf8').split(/\r?\n/);
          for (const line of lines) {
            const w = line.trim().replace(/[^A-Za-z]/g, '').toUpperCase();
            if (!w) continue;
            dictSet.add(w);
            if (w.length >= 2) {
              dictSet.add(w + 'S');
              dictSet.add(w + 'ES');
              dictSet.add(w + 'ED');
              dictSet.add(w + 'ING');
              dictSet.add(w + 'ER');
              dictSet.add(w + 'ERS');
            }
          }
        } catch (e) {}
      }
    }

    const contextualSet = new Set(Array.isArray(tickerData.contextual) ? tickerData.contextual : []);
    const mergedSet = new Set(Array.isArray(tickerData.unambiguous) ? tickerData.unambiguous : []);
    let newlyAdded = 0;

    for (const row of [...stocks, ...etfs]) {
      const sym = String(row.symbol || '').trim().toUpperCase();
      if (
        /^[A-Z]{3,5}$/.test(sym) &&
        !stopwordsSet.has(sym) &&
        !contextualSet.has(sym) &&
        !dictSet.has(sym)
      ) {
        if (!mergedSet.has(sym)) {
          mergedSet.add(sym);
          newlyAdded++;
        }
      }
    }

    const symbols = Array.from(mergedSet).sort();
    const updatedAt = new Date().toISOString().slice(0, 10);
    tickerData.updatedAt = updatedAt;
    tickerData.unambiguous = symbols;

    try {
      fs.writeFileSync(TICKER_DATA_PATH, JSON.stringify(tickerData, null, 2) + '\n', 'utf8');
    } catch (writeErr) {
      console.warn('[Ticker] Failed to write data/ticker-data.json:', writeErr.message);
    }

    return {
      ok: true,
      symbols,
      newlyAdded,
      updatedAt,
      totalRaw: stocks.length + etfs.length
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  // Ensure background webviews (especially Discord client) are never throttled
  app.on('web-contents-created', (event, contents) => {
    contents.setBackgroundThrottling(false);
  });

  // The Discord client runs unattended in the background, so silence anything
  // that would try to prompt the user (notifications, mic, camera, ...).
  const discordSession = session.fromPartition(DISCORD_PARTITION);
  discordSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  discordSession.setPermissionCheckHandler(() => false);

  // Optimize & aggressively cache Twitter/X and Discord static assets and media locally
  session.defaultSession.webRequest.onHeadersReceived({
    urls: [
      '*://platform.twitter.com/*',
      '*://cdn.syndication.twimg.com/*',
      '*://pbs.twimg.com/*',
      '*://abs.twimg.com/*',
      '*://cdn.discordapp.com/*',
      '*://media.discordapp.net/*',
      '*://*.discordapp.net/*'
    ]
  }, (details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    const url = details.url || '';
    if (url.includes('/embed/') || url.includes('widgets.js') || url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.woff2')) {
      responseHeaders['cache-control'] = ['public, max-age=31536000, immutable'];
    } else if (url.includes('tweet-result')) {
      responseHeaders['cache-control'] = ['public, max-age=86400, stale-while-revalidate=604800'];
    } else if (url.includes('pbs.twimg.com') || url.includes('discordapp.com') || url.includes('discordapp.net')) {
      responseHeaders['cache-control'] = ['public, max-age=2592000'];
    }
    callback({ responseHeaders });
  });

  // Set macOS dock icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(ICON_PATH);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
