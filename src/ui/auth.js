const { ipcRenderer } = require('electron');
const {
  getDiscordLoggedIn,
  saveDiscordLoggedIn,
  getThreadsLoggedIn,
  saveThreadsLoggedIn
} = require('../core/storage');
const { t } = require('../core/i18n');

let isTwitterLoggedIn = false;
let lastTwitterStatus = 'checking';
let isThreadsLoggedIn = false;
let lastThreadsStatus = 'checking';
let isDiscordLoggedIn = false;

function updateMenuStatusDot() {
  const dot = document.getElementById('login-menu-status-dot');
  if (!dot) return;

  dot.classList.remove('has-login', 'checking', 'all-logged-out');
  if (isTwitterLoggedIn || isThreadsLoggedIn || isDiscordLoggedIn) {
    dot.classList.add('has-login');
  } else {
    dot.classList.add('all-logged-out');
  }
}

function updateTwitterStatusUI(status) {
  // status: boolean | 'checking'
  lastTwitterStatus = status;
  const badge = document.getElementById('twitter-status-badge');
  const label = document.getElementById('twitter-status-label');
  const item = document.getElementById('item-login-twitter');

  if (status === 'checking') {
    if (badge) badge.className = 'platform-status-badge checking';
    if (label) label.innerText = t('auth.checking');
    if (item) item.title = t('auth.twitterCheckingTitle');
  } else if (status === true) {
    isTwitterLoggedIn = true;
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = t('auth.loggedIn');
    if (item) item.title = t('auth.twitterLoggedInTitle');
  } else {
    isTwitterLoggedIn = false;
    if (badge) badge.className = 'platform-status-badge logged-out';
    if (label) label.innerText = t('auth.loggedOut');
    if (item) item.title = t('auth.twitterLoggedOutTitle');
  }
  updateMenuStatusDot();
}

function updateThreadsStatusUI(status) {
  // status: boolean | 'checking'
  lastThreadsStatus = status;
  const badge = document.getElementById('threads-status-badge');
  const label = document.getElementById('threads-status-label');
  const item = document.getElementById('item-login-threads');

  if (status === 'checking') {
    if (badge) badge.className = 'platform-status-badge checking';
    if (label) label.innerText = t('auth.checking');
    if (item) item.title = t('auth.threadsCheckingTitle');
  } else if (status === true) {
    isThreadsLoggedIn = true;
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = t('auth.loggedIn');
    if (item) item.title = t('auth.threadsLoggedInTitle');
  } else {
    isThreadsLoggedIn = false;
    if (badge) badge.className = 'platform-status-badge logged-out';
    if (label) label.innerText = t('auth.loggedOut');
    if (item) item.title = t('auth.threadsLoggedOutTitle');
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
    if (label) label.innerText = t('auth.loggedIn');
    if (item) item.title = t('auth.discordLoggedInTitle');
  } else {
    if (badge) badge.className = 'platform-status-badge logged-out';
    if (label) label.innerText = t('auth.loggedOut');
    if (item) item.title = t('auth.discordLoggedOutTitle');
  }
  updateMenuStatusDot();
}

function refreshAuthLocaleUI() {
  updateTwitterStatusUI(lastTwitterStatus);
  updateThreadsStatusUI(lastThreadsStatus);
  updateDiscordStatusUI(isDiscordLoggedIn);
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

async function checkThreadsLoginStatus() {
  updateThreadsStatusUI('checking');
  try {
    const loggedIn = await ipcRenderer.invoke('check-threads-login-status');
    saveThreadsLoggedIn(Boolean(loggedIn));
    updateThreadsStatusUI(Boolean(loggedIn));
  } catch (e) {
    updateThreadsStatusUI(getThreadsLoggedIn());
  }
}

function initAuth({ onExportProfile, onImportProfile } = {}) {
  const btnLoginMenu = document.getElementById('btn-login-menu');
  const loginMenu = document.getElementById('login-dropdown-menu');
  const itemTwitter = document.getElementById('item-login-twitter');
  const itemThreads = document.getElementById('item-login-threads');
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

  if (itemThreads) {
    itemThreads.addEventListener('click', () => {
      closeMenu();
      ipcRenderer.send('open-threads-login-window', { wasLoggedIn: isThreadsLoggedIn });
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

  ipcRenderer.on('threads-login-status-changed', (event, { loggedIn }) => {
    saveThreadsLoggedIn(Boolean(loggedIn));
    updateThreadsStatusUI(Boolean(loggedIn));
  });

  ipcRenderer.on('discord-login-status-changed', (event, { loggedIn }) => {
    saveDiscordLoggedIn(loggedIn);
    updateDiscordStatusUI(loggedIn);
  });

  // Initial checks
  checkTwitterLoginStatus();
  checkThreadsLoginStatus();
  updateDiscordStatusUI(getDiscordLoggedIn());

  // Periodically check discord & threads cached status
  setInterval(() => {
    updateDiscordStatusUI(getDiscordLoggedIn());
  }, 5000);
}

module.exports = {
  updateLoginUI: updateTwitterStatusUI,
  updateThreadsLoginUI: updateThreadsStatusUI,
  updateDiscordLoginUI: updateDiscordStatusUI,
  checkLoginStatus: checkTwitterLoginStatus,
  checkThreadsLoginStatus,
  refreshAuthLocaleUI,
  initAuth
};
