const { app, BrowserWindow, ipcMain, session, Menu, shell, Notification, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');
const englishWords = require('an-array-of-english-words');
const { LRUCache } = require('lru-cache');
const { getLinkPreview, getPreviewFromContent } = require('link-preview-js');
const { DISCORD_PARTITION, THREADS_PARTITION, THREADS_LOGIN_URL } = require('./src/core/constants');
const { TWEET_EMBED_ENHANCEMENT_SCRIPT } = require('./src/ui/tweet_embed');
const { t, setActiveLanguageOverride } = require('./src/core/i18n');
const TICKER_DATA_PATH = path
  .join(__dirname, 'data', 'ticker-data.json')
  .replace('app.asar', 'app.asar.unpacked');
const tickerData = require('./data/ticker-data.json');

app.name = 'TheySay';
const IS_BACKGROUND_TEST =
  process.env.THEYSAY_BACKGROUND_TEST === '1' && process.platform === 'darwin';
if (IS_BACKGROUND_TEST) {
  if (typeof app.setActivationPolicy === 'function') {
    try {
      app.setActivationPolicy('accessory');
    } catch (_) {}
  }
  if (app.dock) {
    app.dock.hide();
  }
}
if (process.env.THEYSAY_USER_DATA_DIR) {
  app.setPath('userData', process.env.THEYSAY_USER_DATA_DIR);
}
if (typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('com.laike9m.theysay');
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const DEFAULT_WINDOW_WIDTH = 1360;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 850;
const MIN_WINDOW_HEIGHT = 650;

const preferencesStore = new Store({
  name: 'preferences',
  cwd: app.getPath('userData'),
  clearInvalidConfig: true
});

const windowStateStore = new Store({
  name: 'window-state',
  cwd: app.getPath('userData'),
  clearInvalidConfig: true
});

function loadSavedLanguagePreference() {
  try {
    const lang = preferencesStore.get('language');
    if (lang === 'en' || lang === 'zh') {
      return lang;
    }
  } catch (_) {}
  return null;
}

function saveLanguagePreference(lang) {
  try {
    if (lang === 'en' || lang === 'zh') {
      preferencesStore.set('language', lang);
    } else {
      preferencesStore.delete('language');
    }
  } catch (err) {
    console.warn('[Preferences] Failed to save language preference:', err.message);
  }
}

function loadWindowState() {
  const defaultState = {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT
  };

  try {
    const saved = windowStateStore.store;
    if (!saved || typeof saved !== 'object' || Object.keys(saved).length === 0) {
      return defaultState;
    }

    let width = Number.isFinite(saved.width)
      ? Math.max(MIN_WINDOW_WIDTH, Math.round(saved.width))
      : DEFAULT_WINDOW_WIDTH;
    let height = Number.isFinite(saved.height)
      ? Math.max(MIN_WINDOW_HEIGHT, Math.round(saved.height))
      : DEFAULT_WINDOW_HEIGHT;
    let x = Number.isFinite(saved.x) ? Math.round(saved.x) : undefined;
    let y = Number.isFinite(saved.y) ? Math.round(saved.y) : undefined;

    const displays = screen.getAllDisplays();
    if (Array.isArray(displays) && displays.length > 0 && x !== undefined && y !== undefined) {
      const isVisibleOnAnyDisplay = displays.some((d) => {
        const area = d.workArea || d.bounds;
        return (
          x < area.x + area.width - 100 &&
          x + width > area.x + 100 &&
          y < area.y + area.height - 60 &&
          y + height > area.y
        );
      });

      if (!isVisibleOnAnyDisplay) {
        x = undefined;
        y = undefined;
        const primaryArea = screen.getPrimaryDisplay().workArea;
        if (primaryArea) {
          width = Math.max(MIN_WINDOW_WIDTH, Math.min(width, primaryArea.width));
          height = Math.max(MIN_WINDOW_HEIGHT, Math.min(height, primaryArea.height));
        }
      }
    }

    return {
      x,
      y,
      width,
      height,
      isMaximized: Boolean(saved.isMaximized),
      isFullScreen: Boolean(saved.isFullScreen)
    };
  } catch (err) {
    return defaultState;
  }
}

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
let threadsLoginWindow = null;
let currentAppBadgeCount = 0;
const activeNotifications = new Set();

const DISABLE_WEB_BADGING_SCRIPT = `
  try {
    if (typeof Navigator !== 'undefined' && Navigator.prototype) {
      Navigator.prototype.setAppBadge = () => Promise.resolve();
      Navigator.prototype.clearAppBadge = () => Promise.resolve();
    }
  } catch (_) {}
`;

function applyAppBadgeCount(count) {
  const nextCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  currentAppBadgeCount = nextCount;
  if (IS_BACKGROUND_TEST) return;
  try {
    if (typeof app.setBadgeCount === 'function') {
      app.setBadgeCount(nextCount);
    }
  } catch (_) {}
  if (process.platform === 'darwin' && app.dock && typeof app.dock.setBadge === 'function') {
    try {
      app.dock.setBadge(nextCount > 0 ? String(nextCount) : '');
    } catch (_) {}
  }
}

function enforceHostAppBadge() {
  if (IS_BACKGROUND_TEST) return;
  const expectedBadge = currentAppBadgeCount > 0 ? String(currentAppBadgeCount) : '';
  const countDrifted =
    typeof app.getBadgeCount === 'function' && app.getBadgeCount() !== currentAppBadgeCount;
  const dockDrifted =
    process.platform === 'darwin' &&
    app.dock &&
    typeof app.dock.getBadge === 'function' &&
    app.dock.getBadge() !== expectedBadge;
  if (countDrifted || dockDrifted) {
    applyAppBadgeCount(currentAppBadgeCount);
  }
}

function createWindow() {
  const windowState = loadWindowState();

  const windowOptions = {
    width: windowState.width,
    height: windowState.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: !IS_BACKGROUND_TEST,
    paintWhenInitiallyHidden: true,
    title: t('app.mainWindowTitle'),
    icon: ICON_PATH,
    webPreferences: {
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  };

  if (typeof windowState.x === 'number' && typeof windowState.y === 'number') {
    windowOptions.x = windowState.x;
    windowOptions.y = windowState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (!IS_BACKGROUND_TEST) {
    if (windowState.isFullScreen) {
      mainWindow.setFullScreen(true);
    } else if (windowState.isMaximized && process.platform !== 'darwin') {
      mainWindow.maximize();
    }
  }

  let currentWindowState = {
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    isMaximized: Boolean(windowState.isMaximized),
    isFullScreen: Boolean(windowState.isFullScreen)
  };
  let saveStateTimer = null;

  const updateWindowStateFromWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMaximized = mainWindow.isMaximized();
    const isFullScreen = mainWindow.isFullScreen();
    const isMinimized = mainWindow.isMinimized();

    currentWindowState.isMaximized = isMaximized;
    currentWindowState.isFullScreen = isFullScreen;

    const canRecordNormalBounds =
      process.platform === 'darwin'
        ? !isFullScreen && !isMinimized
        : !isMaximized && !isFullScreen && !isMinimized;

    if (canRecordNormalBounds) {
      const bounds = mainWindow.getBounds();
      if (bounds.width >= MIN_WINDOW_WIDTH && bounds.height >= MIN_WINDOW_HEIGHT) {
        currentWindowState.x = bounds.x;
        currentWindowState.y = bounds.y;
        currentWindowState.width = bounds.width;
        currentWindowState.height = bounds.height;
      }
    }
  };

  const writeWindowStateSync = () => {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    updateWindowStateFromWindow();
    try {
      const stateToSave = {
        width: currentWindowState.width,
        height: currentWindowState.height,
        isMaximized: Boolean(currentWindowState.isMaximized),
        isFullScreen: Boolean(currentWindowState.isFullScreen)
      };
      if (typeof currentWindowState.x === 'number') stateToSave.x = currentWindowState.x;
      if (typeof currentWindowState.y === 'number') stateToSave.y = currentWindowState.y;
      windowStateStore.set(stateToSave);
    } catch (err) {
      console.warn('[WindowState] Failed to save window state:', err.message);
    }
  };

  const scheduleSaveWindowState = () => {
    updateWindowStateFromWindow();
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
    }
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      writeWindowStateSync();
    }, 150);
  };

  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('maximize', scheduleSaveWindowState);
  mainWindow.on('unmaximize', scheduleSaveWindowState);
  mainWindow.on('enter-full-screen', scheduleSaveWindowState);
  mainWindow.on('leave-full-screen', scheduleSaveWindowState);
  mainWindow.on('close', () => {
    writeWindowStateSync();
    try {
      session.defaultSession.flushStorageData();
    } catch (_) {}
  });

  mainWindow.loadFile('index.html');

  // Block automatic popups from embedded tweet iframes; allowed actions
  // (top-right X logo & Read replies button) open explicitly via postMessage.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url.includes('#__theysay_open')) {
      shell.openExternal(url.replace('#__theysay_open', ''));
    }
    return { action: 'deny' };
  });

  const injectIntoEmbedFrames = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const frames = mainWindow.webContents.mainFrame.framesInSubtree || [];
      for (const frame of frames) {
        if (frame && !frame.isDestroyed() && frame.url && frame.url.includes('platform.twitter.com/embed/')) {
          frame.executeJavaScript(TWEET_EMBED_ENHANCEMENT_SCRIPT).catch(() => {});
        }
      }
    } catch (_) {}
  };

  mainWindow.webContents.on('frame-created', (event, { frame }) => {
    if (!frame) return;
    frame.on('dom-ready', () => {
      if (!frame.isDestroyed() && frame.url && frame.url.includes('platform.twitter.com/embed/')) {
        frame.executeJavaScript(TWEET_EMBED_ENHANCEMENT_SCRIPT).catch(() => {});
      }
    });
  });

  mainWindow.webContents.on('did-frame-finish-load', (event, isMainFrame) => {
    if (!isMainFrame) {
      injectIntoEmbedFrames();
    }
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
ipcMain.on('open-login-window', async () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  const xSession = session.fromPartition('persist:x_session');
  let initialAuthToken = '';
  try {
    const cookies = await xSession.cookies.get({ name: 'auth_token' });
    if (cookies.length > 0 && cookies[0].value) {
      initialAuthToken = cookies[0].value;
    }
  } catch (e) {}

  loginWindow = new BrowserWindow({
    width: 620,
    height: 750,
    title: initialAuthToken ? t('app.twitterReloginTitle') : t('app.twitterLoginTitle'),
    icon: ICON_PATH,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      partition: 'persist:x_session',
      backgroundThrottling: false
    }
  });

  // If already logged in, open X's logout/switch confirmation page so the window
  // doesn't immediately redirect from /i/flow/login to /home and auto-close.
  // Scraped data in mainWindow's defaultSession localStorage is never touched.
  const targetUrl = initialAuthToken ? 'https://x.com/logout' : 'https://x.com/i/flow/login';
  loginWindow.loadURL(targetUrl, {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });

  let hasClearedOrVisitedLogin = !initialAuthToken;

  const checkTwitterNavigation = async (url) => {
    try {
      const cookies = await xSession.cookies.get({ name: 'auth_token' });
      const currentToken = cookies.length > 0 && cookies[0].value ? cookies[0].value : '';

      if (!currentToken || url.includes('/login') || url.includes('/i/flow/login')) {
        hasClearedOrVisitedLogin = true;
      }

      if (url.includes('x.com/home') || url === 'https://x.com/' || url === 'https://x.com') {
        if (currentToken && (hasClearedOrVisitedLogin || currentToken !== initialAuthToken)) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('login-status-changed', { loggedIn: true });
          }
          setTimeout(() => {
            if (loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.close();
            }
          }, 1000);
        }
      }
    } catch (e) {}
  };

  // Automatically detect successful login or account switch
  loginWindow.webContents.on('did-navigate', (event, url) => checkTwitterNavigation(url));
  loginWindow.webContents.on('did-navigate-in-page', (event, url) => checkTwitterNavigation(url));

  loginWindow.on('closed', async () => {
    loginWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
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
ipcMain.on('open-discord-login-window', async (event, payload = {}) => {
  if (discordLoginWindow && !discordLoginWindow.isDestroyed()) {
    discordLoginWindow.focus();
    return;
  }

  const discordSession = session.fromPartition(DISCORD_PARTITION);
  // If user is already logged in and clicks to switch Discord account, clear only
  // the Discord partition session so /login does not immediately bounce back to /app
  // and close the window. Main window's scraped data cache is never touched.
  if (payload && payload.wasLoggedIn) {
    try {
      await discordSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage']
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-login-status-changed', { loggedIn: false });
      }
    } catch (e) {}
  }

  discordLoginWindow = new BrowserWindow({
    width: 900,
    height: 760,
    title: payload && payload.wasLoggedIn ? t('app.discordReloginTitle') : t('app.discordLoginTitle'),
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
  let notifiedMainWindow = false;
  const notifyIfLoggedIn = (url) => {
    if (reportedLoggedIn) return;
    if (url.indexOf('discord.com/channels/') < 0 && url.indexOf('discord.com/app') < 0) return;

    reportedLoggedIn = true;
    try {
      discordSession.flushStorageData();
    } catch (_) {}
    if (mainWindow && !mainWindow.isDestroyed() && !notifiedMainWindow) {
      notifiedMainWindow = true;
      mainWindow.webContents.send('discord-login-status-changed', { loggedIn: true });
    }
    setTimeout(() => {
      try {
        discordSession.flushStorageData();
      } catch (_) {}
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
    try {
      discordSession.flushStorageData();
    } catch (_) {}
    if (mainWindow && !mainWindow.isDestroyed() && reportedLoggedIn && !notifiedMainWindow) {
      notifiedMainWindow = true;
      mainWindow.webContents.send('discord-login-status-changed', { loggedIn: true });
    }
  });
});

// Check Threads login status via persist:threads_session cookies
ipcMain.handle('check-threads-login-status', async () => {
  try {
    const threadsSession = session.fromPartition(THREADS_PARTITION);
    const sessionCookies = await threadsSession.cookies.get({ name: 'sessionid' });
    if (sessionCookies.some(c => c && c.value)) return true;
    const userCookies = await threadsSession.cookies.get({ name: 'ds_user_id' });
    return userCookies.some(c => c && c.value);
  } catch (e) {
    return false;
  }
});

async function fetchUrlPreview(targetUrl, { userAgent = DISCORD_USER_AGENT, timeout = 6500 } = {}) {
  const headers = {
    'user-agent': userAgent,
    'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    accept: 'text/html,application/xhtml+xml'
  };
  try {
    return await getLinkPreview(targetUrl, {
      followRedirects: 'follow',
      timeout,
      headers
    });
  } catch (_) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(targetUrl, {
        headers,
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const resHeaders = { 'content-type': 'text/html; charset=utf-8' };
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      return await getPreviewFromContent({
        url: res.url || targetUrl,
        headers: resHeaders,
        data: await res.text()
      });
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  }
}

async function probeTwitterHandle(cleanHandle) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanHandle)) {
    return { exists: false };
  }
  const endpoints = [
    `https://api.fxtwitter.com/${encodeURIComponent(cleanHandle)}`,
    `https://api.vxtwitter.com/${encodeURIComponent(cleanHandle)}`
  ];
  for (const url of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': DISCORD_USER_AGENT,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.status === 404) {
        return { exists: false };
      }
      const data = await res.json().catch(() => null);
      if (data && data.code === 200 && data.user) {
        const rawAvatar = data.user.avatar_url || data.user.profile_image_url_https || '';
        return {
          exists: true,
          handle: data.user.screen_name || cleanHandle,
          displayName: data.user.name || cleanHandle,
          avatarUrl: rawAvatar.includes('_normal.') ? rawAvatar.replace('_normal.', '_400x400.') : rawAvatar
        };
      }
      if (data && data.screen_name) {
        const rawAvatar = data.profile_image_url || '';
        return {
          exists: true,
          handle: data.screen_name || cleanHandle,
          displayName: data.name || cleanHandle,
          avatarUrl: rawAvatar.includes('_normal.') ? rawAvatar.replace('_normal.', '_400x400.') : rawAvatar
        };
      }
      if (data && (data.code === 404 || data.error)) {
        return { exists: false };
      }
    } catch (e) {
      clearTimeout(timer);
    }
  }
  return { exists: false };
}

async function probeThreadsHandle(cleanHandle) {
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(cleanHandle)) {
    return { exists: false };
  }
  const targetUrl = `https://www.threads.com/@${encodeURIComponent(cleanHandle.toLowerCase())}`;
  const preview = await fetchUrlPreview(targetUrl, {
    userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    timeout: 4500
  });
  const rawTitle = String((preview && preview.title) || '').trim();
  const titleParts = rawTitle.match(/^(.+?)\s*[(（]@([A-Za-z0-9_.]+)[)）]/);
  if (titleParts) {
    const rawImg = String((preview && Array.isArray(preview.images) && preview.images[0]) || '');
    const isGenericLogo = rawImg.includes('static.cdninstagram.com/rsrc.php');
    return {
      exists: true,
      handle: titleParts[2].toLowerCase(),
      displayName: titleParts[1].trim(),
      avatarUrl: isGenericLogo ? '' : rawImg
    };
  }
  return { exists: false };
}

ipcMain.handle('probe-handle-platforms', async (event, payload) => {
  const isObj = typeof payload === 'object' && payload !== null;
  const rawHandle = isObj ? payload.handle : payload;
  const threadsOnly = isObj ? Boolean(payload.threadsOnly) : false;
  const cleanHandle = String(rawHandle || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^threads:\s*@?/i, '');
  if (!cleanHandle) {
    return { twitter: { exists: false }, threads: { exists: false } };
  }
  const [twitter, threads] = await Promise.all([
    threadsOnly ? Promise.resolve({ exists: false }) : probeTwitterHandle(cleanHandle),
    probeThreadsHandle(cleanHandle)
  ]);
  return { twitter, threads };
});

// Open dedicated Threads login window
ipcMain.on('open-threads-login-window', async (event, payload = {}) => {
  if (threadsLoginWindow && !threadsLoginWindow.isDestroyed()) {
    threadsLoginWindow.focus();
    return;
  }

  const threadsSession = session.fromPartition(THREADS_PARTITION);
  if (payload && payload.wasLoggedIn) {
    try {
      await threadsSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage']
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('threads-login-status-changed', { loggedIn: false });
      }
    } catch (e) {}
  }

  threadsLoginWindow = new BrowserWindow({
    width: 680,
    height: 760,
    title: payload && payload.wasLoggedIn ? t('app.threadsReloginTitle') : t('app.threadsLoginTitle'),
    icon: ICON_PATH,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      partition: THREADS_PARTITION,
      backgroundThrottling: false
    }
  });

  threadsLoginWindow.loadURL(THREADS_LOGIN_URL, {
    userAgent: DISCORD_USER_AGENT
  });

  let reportedLoggedIn = false;
  const checkThreadsNavigation = async (url) => {
    if (reportedLoggedIn) return;
    try {
      const sessionCookies = await threadsSession.cookies.get({ name: 'sessionid' });
      const userCookies = await threadsSession.cookies.get({ name: 'ds_user_id' });
      const hasSession =
        sessionCookies.some(c => c && c.value) || userCookies.some(c => c && c.value);
      const isThreadsHome =
        (url.includes('threads.com') || url.includes('threads.net')) &&
        !url.includes('/login');

      if (hasSession && isThreadsHome) {
        reportedLoggedIn = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('threads-login-status-changed', { loggedIn: true });
        }
        setTimeout(() => {
          if (threadsLoginWindow && !threadsLoginWindow.isDestroyed()) {
            threadsLoginWindow.close();
          }
        }, 1200);
      }
    } catch (e) {}
  };

  threadsLoginWindow.webContents.on('did-navigate', (event, url) => checkThreadsNavigation(url));
  threadsLoginWindow.webContents.on('did-navigate-in-page', (event, url) => checkThreadsNavigation(url));

  threadsLoginWindow.on('closed', async () => {
    threadsLoginWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const sessionCookies = await threadsSession.cookies.get({ name: 'sessionid' });
        const userCookies = await threadsSession.cookies.get({ name: 'ds_user_id' });
        const loggedIn =
          reportedLoggedIn ||
          sessionCookies.some(c => c && c.value) ||
          userCookies.some(c => c && c.value);
        mainWindow.webContents.send('threads-login-status-changed', { loggedIn });
      } catch (e) {}
    }
  });
});

// Sync active language from renderer process
ipcMain.on('set-language', (event, payload) => {
  const isObj = typeof payload === 'object' && payload !== null;
  const lang = isObj ? payload.lang : payload;
  const persist = isObj ? Boolean(payload.persist) : true;

  if (persist) {
    saveLanguagePreference(lang);
    if (lang === 'en' || lang === 'zh') {
      process.env.THEYSAY_SAVED_LANGUAGE = lang;
    } else {
      delete process.env.THEYSAY_SAVED_LANGUAGE;
    }
    try {
      session.defaultSession.flushStorageData();
    } catch (_) {}
  }

  setActiveLanguageOverride(lang || null);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(t('app.windowTitle'));
  }
});

// Export user profile (all settings + all followed accounts/channels) to a JSON file
ipcMain.handle('export-profile', async (event, payload = {}) => {
  try {
    const profileData =
      payload && payload.profileData && typeof payload.profileData === 'object'
        ? payload.profileData
        : payload;
    const dateStr = new Date().toISOString().slice(0, 10);
    const defaultPath = path.join(app.getPath('downloads'), `theysay-profile-${dateStr}.json`);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: t('app.exportDialogTitle'),
      defaultPath,
      buttonLabel: t('app.exportDialogButton'),
      filters: [{ name: 'JSON Profile', extensions: ['json'] }]
    });
    if (canceled || !filePath) {
      return { ok: false, canceled: true };
    }
    fs.writeFileSync(filePath, JSON.stringify(profileData, null, 2) + '\n', 'utf8');
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Import user profile from a JSON file
ipcMain.handle('import-profile', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: t('app.importDialogTitle'),
      buttonLabel: t('app.importDialogButton'),
      properties: ['openFile'],
      filters: [{ name: 'JSON Profile', extensions: ['json'] }]
    });
    if (canceled || !Array.isArray(filePaths) || filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const filePath = filePaths[0];
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const profile =
      parsed && parsed.profileData && typeof parsed.profileData === 'object'
        ? parsed.profileData
        : parsed;
    if (!profile || typeof profile !== 'object') {
      return { ok: false, error: t('app.invalidProfileJson') };
    }
    return { ok: true, profile, profileData: profile, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
    for (const word of englishWords) {
      if (word.length >= 3 && word.length <= 5) {
        dictSet.add(word.toUpperCase());
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

ipcMain.on('flush-storage-data', () => {
  try {
    session.defaultSession.flushStorageData();
  } catch (_) {}
});

ipcMain.on('set-app-badge', (event, count) => {
  applyAppBadgeCount(Number(count) || 0);
});

ipcMain.handle('get-app-badge-count', () => currentAppBadgeCount);

const mainUrlTitleCache = new LRUCache({ max: 1000 });

ipcMain.handle('fetch-url-title', async (event, rawUrl) => {
  try {
    const cleanInput = String(rawUrl || '').trim();
    if (!cleanInput) return { ok: false, url: cleanInput, title: '' };
    const targetUrl = /^https?:\/\//i.test(cleanInput) ? cleanInput : `https://${cleanInput}`;

    if (mainUrlTitleCache.has(targetUrl)) {
      const cachedTitle = mainUrlTitleCache.get(targetUrl);
      return { ok: Boolean(cachedTitle), url: cleanInput, title: cachedTitle };
    }

    const preview = await fetchUrlPreview(targetUrl, {
      userAgent: DISCORD_USER_AGENT,
      timeout: 6500
    });

    const title = String((preview && preview.title) || '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
    const finalUrl = (preview && preview.url) || targetUrl;

    if (title) {
      mainUrlTitleCache.set(targetUrl, title);
      if (finalUrl && finalUrl !== targetUrl) {
        mainUrlTitleCache.set(finalUrl, title);
      }
      return { ok: true, url: cleanInput, finalUrl, title };
    }

    return { ok: false, url: cleanInput, title: '' };
  } catch (err) {
    return { ok: false, url: String(rawUrl || ''), title: '', error: err.message };
  }
});

app.whenReady().then(() => {
  // Ensure background webviews (especially Discord client) are never throttled
  // and cannot override the host app's Dock / taskbar unread badge.
  app.on('web-contents-created', (event, contents) => {
    contents.setBackgroundThrottling(false);
    const silenceGuestBadging = () => {
      try {
        if (!contents.isDestroyed()) {
          contents.executeJavaScript(DISABLE_WEB_BADGING_SCRIPT).catch(() => {});
        }
      } catch (_) {}
      enforceHostAppBadge();
    };
    contents.on('dom-ready', silenceGuestBadging);
    contents.on('did-finish-load', silenceGuestBadging);
    contents.on('did-navigate', silenceGuestBadging);
    contents.on('did-navigate-in-page', silenceGuestBadging);
    contents.on('page-title-updated', () => enforceHostAppBadge());
  });

  // The Discord & Threads clients run unattended in the background, so silence anything
  // that would try to prompt the user (notifications, mic, camera, ...).
  const discordSession = session.fromPartition(DISCORD_PARTITION);
  discordSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  discordSession.setPermissionCheckHandler(() => false);

  const threadsSession = session.fromPartition(THREADS_PARTITION);
  threadsSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  threadsSession.setPermissionCheckHandler(() => false);

  // Optimize & aggressively cache Twitter/X, Threads, and Discord static assets and media locally
  session.defaultSession.webRequest.onHeadersReceived({
    urls: [
      '*://platform.twitter.com/*',
      '*://cdn.syndication.twimg.com/*',
      '*://pbs.twimg.com/*',
      '*://abs.twimg.com/*',
      '*://cdn.discordapp.com/*',
      '*://media.discordapp.net/*',
      '*://*.discordapp.net/*',
      '*://*.cdninstagram.com/*',
      '*://*.fbcdn.net/*'
    ]
  }, (details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    const url = details.url || '';
    if (url.includes('cdninstagram.com') || url.includes('fbcdn.net')) {
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === 'cross-origin-resource-policy') {
          delete responseHeaders[key];
        }
      }
      responseHeaders['cross-origin-resource-policy'] = ['cross-origin'];
    }
    if (url.includes('/embed/') || url.includes('widgets.js') || url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.woff2')) {
      responseHeaders['cache-control'] = ['public, max-age=31536000, immutable'];
    } else if (url.includes('tweet-result')) {
      responseHeaders['cache-control'] = ['public, max-age=86400, stale-while-revalidate=604800'];
    } else if (
      url.includes('pbs.twimg.com') ||
      url.includes('discordapp.com') ||
      url.includes('discordapp.net') ||
      url.includes('cdninstagram.com') ||
      url.includes('fbcdn.net')
    ) {
      responseHeaders['cache-control'] = ['public, max-age=2592000'];
    }
    callback({ responseHeaders });
  });

  // Set macOS dock icon (or keep hidden during background integration tests)
  if (process.platform === 'darwin' && app.dock) {
    if (IS_BACKGROUND_TEST) {
      app.dock.hide();
    } else {
      app.dock.setIcon(ICON_PATH);
    }
  }
  applyAppBadgeCount(0);
  const badgeGuardTimer = setInterval(enforceHostAppBadge, 1500);
  if (badgeGuardTimer && typeof badgeGuardTimer.unref === 'function') {
    badgeGuardTimer.unref();
  }

  if (!process.env.THEYSAY_SYSTEM_LOCALE) {
    try {
      const preferred =
        typeof app.getPreferredSystemLanguages === 'function'
          ? app.getPreferredSystemLanguages()
          : [];
      const osLocale =
        (Array.isArray(preferred) && preferred[0]) ||
        (typeof app.getSystemLocale === 'function' ? app.getSystemLocale() : '') ||
        (typeof app.getLocale === 'function' ? app.getLocale() : '');
      if (osLocale) {
        process.env.THEYSAY_SYSTEM_LOCALE = osLocale;
      }
    } catch (_) {}
  }

  const savedLangPref = loadSavedLanguagePreference();
  if (savedLangPref === 'en' || savedLangPref === 'zh') {
    process.env.THEYSAY_SAVED_LANGUAGE = savedLangPref;
    setActiveLanguageOverride(savedLangPref);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  try {
    session.defaultSession.flushStorageData();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
