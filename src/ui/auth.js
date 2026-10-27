const { ipcRenderer } = require('electron');
const { DISCORD_WEBVIEW_ID } = require('../core/constants');
const {
  getSlotCache,
  getTargetCache,
  getDiscordLoggedIn,
  saveDiscordLoggedIn,
  getThreadsLoggedIn,
  saveThreadsLoggedIn,
  getTwitterEverLoggedIn,
  saveTwitterEverLoggedIn,
  getThreadsEverLoggedIn,
  saveThreadsEverLoggedIn,
  getDiscordEverLoggedIn,
  saveDiscordEverLoggedIn,
  getTwitterLoginExpired,
  saveTwitterLoginExpired,
  getThreadsLoginExpired,
  saveThreadsLoginExpired,
  getDiscordLoginExpired,
  saveDiscordLoginExpired,
  getPlatformEverLoggedIn,
  savePlatformEverLoggedIn,
  getPlatformLoginExpired,
  savePlatformLoginExpired
} = require('../core/storage');
const { detectSourceType } = require('../core/source');
const { t } = require('../core/i18n');

let isTwitterLoggedIn = false;
let lastTwitterStatus = 'checking';
let isThreadsLoggedIn = false;
let lastThreadsStatus = 'checking';
let isDiscordLoggedIn = false;

let authCallbacks = {
  onLoginSuccess: null,
  onExpiredStateChange: null
};

const PLATFORM_DISPLAY_NAMES = {
  twitter: 'Twitter / X',
  threads: 'Threads',
  discord: 'Discord'
};

function notifyExpiredStateChange() {
  if (typeof authCallbacks.onExpiredStateChange === 'function') {
    try {
      authCallbacks.onExpiredStateChange();
    } catch (e) {
      console.error('[Auth] onExpiredStateChange callback failed:', e);
    }
  }
}

function unloadDiscordBgWebviewForAuth() {
  try {
    const wv = document.getElementById(DISCORD_WEBVIEW_ID);
    if (!wv) return;
    const currentUrl = (typeof wv.getURL === 'function' ? wv.getURL() : wv.getAttribute('src')) || '';
    if (currentUrl && currentUrl !== 'about:blank') {
      wv.setAttribute('src', 'about:blank');
    }
  } catch (_) {}
}

function openPlatformLoginWindow(platform) {
  if (platform === 'discord') {
    unloadDiscordBgWebviewForAuth();
    ipcRenderer.send('open-discord-login-window', { wasLoggedIn: isDiscordLoggedIn });
  } else if (platform === 'threads') {
    ipcRenderer.send('open-threads-login-window', { wasLoggedIn: isThreadsLoggedIn });
  } else if (platform === 'twitter') {
    ipcRenderer.send('open-login-window');
  }
}

function getExpiredPlatforms() {
  const expired = [];
  if (getDiscordLoginExpired() && !isDiscordLoggedIn) {
    expired.push('discord');
  }
  if (getTwitterLoginExpired() && !isTwitterLoggedIn) {
    expired.push('twitter');
  }
  if (getThreadsLoginExpired() && !isThreadsLoggedIn) {
    expired.push('threads');
  }
  return expired;
}

function isPlatformLoginExpired(platform) {
  if (platform === 'discord') return getDiscordLoginExpired() && !isDiscordLoggedIn;
  if (platform === 'twitter') return getTwitterLoginExpired() && !isTwitterLoggedIn;
  if (platform === 'threads') return getThreadsLoginExpired() && !isThreadsLoggedIn;
  return false;
}

function renderAuthExpiredBanner() {
  const banner = document.getElementById('auth-expired-banner');
  if (!banner) return;

  const expiredPlatforms = getExpiredPlatforms();
  const wasVisible = banner.style.display !== 'none';

  if (expiredPlatforms.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    if (wasVisible) {
      notifyExpiredStateChange();
    }
    return;
  }

  const platformNames = expiredPlatforms.map(p => PLATFORM_DISPLAY_NAMES[p] || p).join(' / ');
  const bannerText = t('auth.expiredBannerText', { platforms: platformNames });

  banner.innerHTML = '';

  const leftEl = document.createElement('div');
  leftEl.className = 'auth-expired-banner-left';

  const iconEl = document.createElement('span');
  iconEl.className = 'auth-expired-banner-icon';
  iconEl.textContent = '!';

  const textEl = document.createElement('span');
  textEl.className = 'auth-expired-banner-text';
  textEl.textContent = bannerText;

  leftEl.appendChild(iconEl);
  leftEl.appendChild(textEl);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'auth-expired-banner-actions';

  expiredPlatforms.forEach((platform) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-expired-login-btn';
    btn.setAttribute('data-platform', platform);
    btn.textContent = t('auth.expiredBannerLoginBtn', {
      platform: PLATFORM_DISPLAY_NAMES[platform] || platform
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlatformLoginWindow(platform);
    });
    actionsEl.appendChild(btn);
  });

  banner.appendChild(leftEl);
  banner.appendChild(actionsEl);
  banner.style.display = 'flex';

  if (!wasVisible) {
    notifyExpiredStateChange();
  }
}

function updateMenuStatusDot() {
  const dot = document.getElementById('login-menu-status-dot');
  const btn = document.getElementById('btn-login-menu');
  if (!dot) return;

  const hasExpired = getExpiredPlatforms().length > 0;
  dot.classList.remove('has-login', 'has-expired', 'checking', 'all-logged-out');
  if (btn) {
    btn.classList.toggle('has-expired', hasExpired);
  }

  if (hasExpired) {
    dot.classList.add('has-expired');
  } else if (isTwitterLoggedIn || isThreadsLoggedIn || isDiscordLoggedIn) {
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
    saveTwitterEverLoggedIn(true);
    saveTwitterLoginExpired(false);
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = t('auth.loggedIn');
    if (item) item.title = t('auth.twitterLoggedInTitle');
  } else {
    isTwitterLoggedIn = false;
    const expired = getTwitterLoginExpired();
    if (badge) badge.className = expired ? 'platform-status-badge expired' : 'platform-status-badge logged-out';
    if (label) label.innerText = expired ? t('auth.expired') : t('auth.loggedOut');
    if (item) item.title = expired ? t('auth.twitterExpiredTitle') : t('auth.twitterLoggedOutTitle');
  }
  updateMenuStatusDot();
  renderAuthExpiredBanner();
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
    saveThreadsEverLoggedIn(true);
    saveThreadsLoginExpired(false);
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = t('auth.loggedIn');
    if (item) item.title = t('auth.threadsLoggedInTitle');
  } else {
    isThreadsLoggedIn = false;
    const expired = getThreadsLoginExpired();
    if (badge) badge.className = expired ? 'platform-status-badge expired' : 'platform-status-badge logged-out';
    if (label) label.innerText = expired ? t('auth.expired') : t('auth.loggedOut');
    if (item) item.title = expired ? t('auth.threadsExpiredTitle') : t('auth.threadsLoggedOutTitle');
  }
  updateMenuStatusDot();
  renderAuthExpiredBanner();
}

function updateDiscordStatusUI(isLoggedIn) {
  isDiscordLoggedIn = Boolean(isLoggedIn);
  const badge = document.getElementById('discord-status-badge');
  const label = document.getElementById('discord-status-label');
  const item = document.getElementById('item-login-discord');

  if (isDiscordLoggedIn) {
    saveDiscordEverLoggedIn(true);
    saveDiscordLoginExpired(false);
    if (badge) badge.className = 'platform-status-badge logged-in';
    if (label) label.innerText = t('auth.loggedIn');
    if (item) item.title = t('auth.discordLoggedInTitle');
  } else {
    const expired = getDiscordLoginExpired();
    if (badge) badge.className = expired ? 'platform-status-badge expired' : 'platform-status-badge logged-out';
    if (label) label.innerText = expired ? t('auth.expired') : t('auth.loggedOut');
    if (item) item.title = expired ? t('auth.discordExpiredTitle') : t('auth.discordLoggedOutTitle');
  }
  updateMenuStatusDot();
  renderAuthExpiredBanner();
}

function markPlatformLoginExpired(platform, { force = false } = {}) {
  const everLoggedIn = getPlatformEverLoggedIn(platform);
  if (!everLoggedIn && !force) {
    // Initial unlogged-in state: do not mark as expired.
    if (platform === 'discord') {
      saveDiscordLoggedIn(false);
      updateDiscordStatusUI(false);
    } else if (platform === 'threads') {
      saveThreadsLoggedIn(false);
      updateThreadsStatusUI(false);
    } else if (platform === 'twitter') {
      updateTwitterStatusUI(false);
    }
    return false;
  }

  savePlatformEverLoggedIn(platform, true);
  savePlatformLoginExpired(platform, true);

  if (platform === 'discord') {
    saveDiscordLoggedIn(false);
    unloadDiscordBgWebviewForAuth();
    updateDiscordStatusUI(false);
  } else if (platform === 'threads') {
    saveThreadsLoggedIn(false);
    updateThreadsStatusUI(false);
  } else if (platform === 'twitter') {
    updateTwitterStatusUI(false);
  }

  notifyExpiredStateChange();
  return true;
}

function markPlatformLoginSuccess(platform) {
  const wasExpired = getPlatformLoginExpired(platform);
  savePlatformEverLoggedIn(platform, true);
  savePlatformLoginExpired(platform, false);

  if (platform === 'discord') {
    saveDiscordLoggedIn(true);
    updateDiscordStatusUI(true);
  } else if (platform === 'threads') {
    saveThreadsLoggedIn(true);
    updateThreadsStatusUI(true);
  } else if (platform === 'twitter') {
    updateTwitterStatusUI(true);
  }

  if (wasExpired) {
    notifyExpiredStateChange();
  }
}

/**
 * Inspects restored slots and local cache on startup to distinguish between:
 * 1) Initial unlogged-in state on first launch (never logged in, no cached data from authenticated sessions)
 * 2) Expired session state (previously logged in or has cached Discord data that could only be fetched while logged in)
 */
function syncAuthStateFromCache(slots = []) {
  try {
    let hasCachedDiscordPosts = false;

    const checkEntry = (entry) => {
      if (!entry || typeof entry !== 'object') return;
      const posts = Array.isArray(entry.posts) ? entry.posts : (Array.isArray(entry.tweets) ? entry.tweets : []);
      if (posts.length === 0) return;
      const src = entry.source || (entry.handle ? detectSourceType(entry.handle) : '');
      if (src === 'discord') {
        hasCachedDiscordPosts = true;
      }
    };

    if (Array.isArray(slots)) {
      slots.forEach((slot) => {
        if (!slot) return;
        const posts = Array.isArray(slot.loadedPosts) ? slot.loadedPosts : [];
        if (posts.length > 0 && slot.source === 'discord') {
          hasCachedDiscordPosts = true;
        }
      });
    }

    const slotCache = getSlotCache();
    Object.values(slotCache || {}).forEach(checkEntry);

    const targetCache = getTargetCache();
    Object.values(targetCache || {}).forEach(checkEntry);

    // Discord always requires authentication to fetch channel messages.
    // If cached Discord messages exist, the user definitely logged in previously.
    if (hasCachedDiscordPosts && !getDiscordEverLoggedIn()) {
      saveDiscordEverLoggedIn(true);
    }

    if (getDiscordLoggedIn()) {
      saveDiscordEverLoggedIn(true);
      saveDiscordLoginExpired(false);
    } else if (getDiscordEverLoggedIn()) {
      saveDiscordLoginExpired(true);
    }

    if (getThreadsLoggedIn()) {
      saveThreadsEverLoggedIn(true);
      saveThreadsLoginExpired(false);
    } else if (getThreadsEverLoggedIn()) {
      saveThreadsLoginExpired(true);
    }

    updateDiscordStatusUI(getDiscordLoggedIn());
    if (lastThreadsStatus !== 'checking') {
      updateThreadsStatusUI(getThreadsLoggedIn());
    }
    if (lastTwitterStatus !== 'checking') {
      updateTwitterStatusUI(isTwitterLoggedIn);
    }
    notifyExpiredStateChange();
  } catch (e) {
    console.error('[Auth] syncAuthStateFromCache failed:', e);
  }
}

function refreshAuthLocaleUI() {
  updateTwitterStatusUI(lastTwitterStatus);
  updateThreadsStatusUI(lastThreadsStatus);
  updateDiscordStatusUI(isDiscordLoggedIn);
  renderAuthExpiredBanner();
}

async function checkTwitterLoginStatus() {
  updateTwitterStatusUI('checking');
  try {
    const loggedIn = Boolean(await ipcRenderer.invoke('check-login-status'));
    if (loggedIn) {
      markPlatformLoginSuccess('twitter');
    } else if (getTwitterEverLoggedIn()) {
      markPlatformLoginExpired('twitter');
    } else {
      updateTwitterStatusUI(false);
    }
  } catch (e) {
    updateTwitterStatusUI(false);
  }
}

async function checkThreadsLoginStatus() {
  updateThreadsStatusUI('checking');
  try {
    const loggedIn = Boolean(await ipcRenderer.invoke('check-threads-login-status'));
    saveThreadsLoggedIn(loggedIn);
    if (loggedIn) {
      markPlatformLoginSuccess('threads');
    } else if (getThreadsEverLoggedIn()) {
      markPlatformLoginExpired('threads');
    } else {
      updateThreadsStatusUI(false);
    }
  } catch (e) {
    updateThreadsStatusUI(getThreadsLoggedIn());
  }
}

function initAuth({ onExportProfile, onImportProfile, onLoginSuccess, onExpiredStateChange } = {}) {
  if (typeof onLoginSuccess === 'function') {
    authCallbacks.onLoginSuccess = onLoginSuccess;
  }
  if (typeof onExpiredStateChange === 'function') {
    authCallbacks.onExpiredStateChange = onExpiredStateChange;
  }

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
      openPlatformLoginWindow('twitter');
    });
  }

  if (itemThreads) {
    itemThreads.addEventListener('click', () => {
      closeMenu();
      openPlatformLoginWindow('threads');
    });
  }

  if (itemDiscord) {
    itemDiscord.addEventListener('click', () => {
      closeMenu();
      openPlatformLoginWindow('discord');
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
    if (loggedIn) {
      markPlatformLoginSuccess('twitter');
      if (typeof authCallbacks.onLoginSuccess === 'function') {
        authCallbacks.onLoginSuccess('twitter');
      }
    } else if (getTwitterEverLoggedIn()) {
      markPlatformLoginExpired('twitter');
    } else {
      updateTwitterStatusUI(false);
    }
  });

  ipcRenderer.on('threads-login-status-changed', (event, { loggedIn }) => {
    const isLogged = Boolean(loggedIn);
    saveThreadsLoggedIn(isLogged);
    if (isLogged) {
      markPlatformLoginSuccess('threads');
      if (typeof authCallbacks.onLoginSuccess === 'function') {
        authCallbacks.onLoginSuccess('threads');
      }
    } else if (getThreadsEverLoggedIn()) {
      markPlatformLoginExpired('threads');
    } else {
      updateThreadsStatusUI(false);
    }
  });

  ipcRenderer.on('discord-login-status-changed', (event, { loggedIn }) => {
    const isLogged = Boolean(loggedIn);
    saveDiscordLoggedIn(isLogged);
    if (isLogged) {
      markPlatformLoginSuccess('discord');
      if (typeof authCallbacks.onLoginSuccess === 'function') {
        authCallbacks.onLoginSuccess('discord');
      }
    } else if (getDiscordEverLoggedIn()) {
      markPlatformLoginExpired('discord');
    } else {
      updateDiscordStatusUI(false);
    }
  });

  // Initial checks
  checkTwitterLoginStatus();
  checkThreadsLoginStatus();
  updateDiscordStatusUI(getDiscordLoggedIn());

  // Periodically check discord status
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
  markPlatformLoginExpired,
  markPlatformLoginSuccess,
  isPlatformLoginExpired,
  getExpiredPlatforms,
  openPlatformLoginWindow,
  syncAuthStateFromCache,
  renderAuthExpiredBanner,
  refreshAuthLocaleUI,
  initAuth
};
