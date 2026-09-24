const { ipcRenderer } = require('electron');
const { getDiscordLoggedIn, saveDiscordLoggedIn } = require('./storage');

function updateLoginUI(isLoggedIn, btnLoginStatus, loginStatusText) {
  if (!btnLoginStatus) return;
  btnLoginStatus.classList.remove('checking', 'logged-in', 'logged-out');
  if (isLoggedIn) {
    btnLoginStatus.classList.add('logged-in');
    if (loginStatusText) loginStatusText.innerText = '已登录 X';
    btnLoginStatus.title = '点击重新登录或切换账号';
  } else {
    btnLoginStatus.classList.add('logged-out');
    if (loginStatusText) loginStatusText.innerText = '🔑 登录 X 账号';
    btnLoginStatus.title = '点击弹出窗口登录 Twitter / X 账号';
  }
}

async function checkLoginStatus(btnLoginStatus, loginStatusText) {
  try {
    const isLoggedIn = await ipcRenderer.invoke('check-login-status');
    updateLoginUI(isLoggedIn, btnLoginStatus, loginStatusText);
  } catch (e) {
    updateLoginUI(false, btnLoginStatus, loginStatusText);
  }
}

function updateDiscordLoginUI(isLoggedIn, btnDiscordLogin, discordStatusText) {
  if (!btnDiscordLogin) return;
  btnDiscordLogin.classList.remove('checking', 'logged-in', 'logged-out');
  if (isLoggedIn) {
    btnDiscordLogin.classList.add('logged-in');
    if (discordStatusText) discordStatusText.innerText = '已登录 Discord';
    btnDiscordLogin.title = '点击重新登录或切换 Discord 账号';
  } else {
    btnDiscordLogin.classList.add('logged-out');
    if (discordStatusText) discordStatusText.innerText = '🔑 登录 Discord';
    btnDiscordLogin.title = '点击弹出窗口登录 Discord，登录后即可监控私有频道';
  }
}

/**
 * Discord's session lives in localStorage, which the main process cannot read,
 * so the button reflects a locally cached flag. It is corrected in both
 * directions: the login window sets it, and any scrape that lands on /login
 * clears it (see storage.saveDiscordLoggedIn).
 */
function initDiscordAuth(btnDiscordLogin, discordStatusText) {
  if (btnDiscordLogin) {
    btnDiscordLogin.addEventListener('click', () => {
      ipcRenderer.send('open-discord-login-window');
    });
  }

  ipcRenderer.on('discord-login-status-changed', (event, { loggedIn }) => {
    saveDiscordLoggedIn(loggedIn);
    updateDiscordLoginUI(loggedIn, btnDiscordLogin, discordStatusText);
  });

  updateDiscordLoginUI(getDiscordLoggedIn(), btnDiscordLogin, discordStatusText);

  // A failed scrape flips the stored flag without going through IPC, so keep the
  // button honest by re-reading it periodically.
  setInterval(() => {
    updateDiscordLoginUI(getDiscordLoggedIn(), btnDiscordLogin, discordStatusText);
  }, 5000);
}

function initAuth(btnLoginStatus, loginStatusText, btnDiscordLogin, discordStatusText) {
  if (btnLoginStatus) {
    btnLoginStatus.addEventListener('click', () => {
      ipcRenderer.send('open-login-window');
    });
  }

  ipcRenderer.on('login-status-changed', (event, { loggedIn }) => {
    updateLoginUI(loggedIn, btnLoginStatus, loginStatusText);
  });

  checkLoginStatus(btnLoginStatus, loginStatusText);
  initDiscordAuth(btnDiscordLogin, discordStatusText);
}

module.exports = {
  updateLoginUI,
  updateDiscordLoginUI,
  checkLoginStatus,
  initAuth
};
