const { ipcRenderer } = require('electron');
const { getDiscordLoggedIn, saveDiscordLoggedIn } = require('./storage');

let isTwitterLoggedIn = false;
let isDiscordLoggedIn = false;

function updateMenuStatusDot() {
  const dot = document.getElementById('login-menu-status-dot');
  if (!dot) return;

  dot.classList.remove('has-login', 'checking', 'all-logged-out');
  if (isTwitterLoggedIn || isDiscordLoggedIn) {
    dot.classList.add('has-login');
  } else {
    dot.classList.add('all-logged-out');
  }
}

function updateTwitterStatusUI(status) {
  // status: boolean | 'checking'
  const badge = document.getElementById('twitter-status-badge');
  const label = document.getElementById('twitter-status-label');
  const item = document.getElementById('item-login-twitter');

  if (status === 'checking') {
    if (badge) badge.className = 'platform-status-badge checking';
    if (label) label.innerText = '检测中...';
    if (item) item.title = 'Twitter / X: 正在检测登录状态';
  } else if (status === true) {
    isTwitterLoggedIn = true;
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = '已登录';
    if (item) item.title = 'Twitter / X: 已登录 (点击重新登录或切换账号)';
  } else {
    isTwitterLoggedIn = false;
    if (badge) badge.className = 'platform-status-badge logged-out';
    if (label) label.innerText = '未登录';
    if (item) item.title = 'Twitter / X: 未登录 (点击弹出窗口登录)';
  }
  updateMenuStatusDot();
}

function updateDiscordStatusUI(isLoggedIn) {
  isDiscordLoggedIn = Boolean(isLoggedIn);
  const badge = document.getElementById('discord-status-badge');
  const label = document.getElementById('discord-status-label');
  const item = document.getElementById('item-login-discord');

  if (isLoggedIn) {
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = '已登录';
    if (item) item.title = 'Discord: 已登录 (点击重新登录或切换账号)';
  } else {
    if (badge) badge.className = 'platform-status-badge logged-out';
    if (label) label.innerText = '未登录';
    if (item) item.title = 'Discord: 未登录 (点击弹出窗口登录以监控私有频道)';
  }
  updateMenuStatusDot();
}

async function checkTwitterLoginStatus() {
  updateTwitterStatusUI('checking');
  try {
    const loggedIn = await ipcRenderer.invoke('check-login-status');
    updateTwitterStatusUI(loggedIn);
  } catch (e) {
    updateTwitterStatusUI(false);
  }
}

function initAuth({ onExportProfile, onImportProfile } = {}) {
  const btnLoginMenu = document.getElementById('btn-login-menu');
  const loginMenu = document.getElementById('login-dropdown-menu');
  const itemTwitter = document.getElementById('item-login-twitter');
  const itemDiscord = document.getElementById('item-login-discord');
  const itemExportProfile = document.getElementById('item-export-profile');
  const itemImportProfile = document.getElementById('item-import-profile');

  function toggleMenu(forceOpen) {
    if (!loginMenu || !btnLoginMenu) return;
    const isCurrentlyOpen = loginMenu.style.display !== 'none';
    const shouldOpen = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;

    if (shouldOpen) {
      loginMenu.style.display = 'block';
      loginMenu.classList.add('is-open');
      btnLoginMenu.classList.add('active');
    } else {
      loginMenu.classList.remove('is-open');
      btnLoginMenu.classList.remove('active');
      loginMenu.style.display = 'none';
    }
  }

  function closeMenu() {
    toggleMenu(false);
  }

  if (btnLoginMenu) {
    btnLoginMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }

  if (loginMenu) {
    loginMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  document.addEventListener('click', () => {
    closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
    }
  });

  if (itemTwitter) {
    itemTwitter.addEventListener('click', () => {
      closeMenu();
      ipcRenderer.send('open-login-window');
    });
  }

  if (itemDiscord) {
    itemDiscord.addEventListener('click', () => {
      closeMenu();
      ipcRenderer.send('open-discord-login-window', { wasLoggedIn: isDiscordLoggedIn });
    });
  }

  if (itemExportProfile) {
    itemExportProfile.addEventListener('click', () => {
      closeMenu();
      if (typeof onExportProfile === 'function') {
        onExportProfile();
      }
    });
  }

  if (itemImportProfile) {
    itemImportProfile.addEventListener('click', () => {
      closeMenu();
      if (typeof onImportProfile === 'function') {
        onImportProfile();
      }
    });
  }

  ipcRenderer.on('login-status-changed', (event, { loggedIn }) => {
    updateTwitterStatusUI(loggedIn);
  });

  ipcRenderer.on('discord-login-status-changed', (event, { loggedIn }) => {
    saveDiscordLoggedIn(loggedIn);
    updateDiscordStatusUI(loggedIn);
  });

  // Initial checks
  checkTwitterLoginStatus();
  updateDiscordStatusUI(getDiscordLoggedIn());

  // Periodically check discord cached status
  setInterval(() => {
    updateDiscordStatusUI(getDiscordLoggedIn());
  }, 5000);
}

module.exports = {
  updateLoginUI: updateTwitterStatusUI,
  updateDiscordLoginUI: updateDiscordStatusUI,
  checkLoginStatus: checkTwitterLoginStatus,
  initAuth
};
