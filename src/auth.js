const { ipcRenderer } = require('electron');

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

function initAuth(btnLoginStatus, loginStatusText) {
  if (btnLoginStatus) {
    btnLoginStatus.addEventListener('click', () => {
      ipcRenderer.send('open-login-window');
    });
  }

  ipcRenderer.on('login-status-changed', (event, { loggedIn }) => {
    updateLoginUI(loggedIn, btnLoginStatus, loginStatusText);
  });

  checkLoginStatus(btnLoginStatus, loginStatusText);
}

module.exports = {
  updateLoginUI,
  checkLoginStatus,
  initAuth
};
