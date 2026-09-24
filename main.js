const { app, BrowserWindow, ipcMain, session, Menu, shell } = require('electron');
const path = require('path');
const { DISCORD_PARTITION } = require('./src/constants');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 850,
    minHeight: 650,
    title: 'TheySay - Twitter / X 动态网格看板 (GridStack)',
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

app.whenReady().then(() => {
  // The Discord client runs unattended in the background, so silence anything
  // that would try to prompt the user (notifications, mic, camera, ...).
  session.fromPartition(DISCORD_PARTITION)
    .setPermissionRequestHandler((webContents, permission, callback) => callback(false));

  // Optimize & aggressively cache Twitter/X static assets and syndication data locally
  session.defaultSession.webRequest.onHeadersReceived({
    urls: [
      '*://platform.twitter.com/*',
      '*://cdn.syndication.twimg.com/*',
      '*://pbs.twimg.com/*',
      '*://abs.twimg.com/*'
    ]
  }, (details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    const url = details.url || '';
    if (url.includes('/embed/') || url.includes('widgets.js') || url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.woff2')) {
      responseHeaders['cache-control'] = ['public, max-age=31536000, immutable'];
    } else if (url.includes('tweet-result')) {
      responseHeaders['cache-control'] = ['public, max-age=86400, stale-while-revalidate=604800'];
    } else if (url.includes('pbs.twimg.com')) {
      responseHeaders['cache-control'] = ['public, max-age=2592000'];
    }
    callback({ responseHeaders });
  });

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
