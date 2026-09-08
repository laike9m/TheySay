const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let loginWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 850,
    minHeight: 650,
    title: 'TheySay - Twitter / X 4 栏推文看板',
    webPreferences: {
      webviewTag: true,
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');

  // Ensure Cmd+R / Ctrl+R always reloads the main app window
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if ((input.meta || input.control) && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        mainWindow.reload();
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

app.whenReady().then(() => {
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
