const { ipcRenderer, shell } = require('electron');

const MAX_SLOTS = 16;
const DEFAULT_HANDLES = [
  'elonmusk', 'OpenAI', 'sama', 'karpathy',
  'ylecun', 'sama', 'sama', 'sama',
  'sama', 'sama', 'sama', 'sama',
  'sama', 'sama', 'sama', 'sama'
];

const STORAGE_HANDLES_KEY = 'theysay_slot_handles';
const STORAGE_CACHE_KEY = 'theysay_slot_cache';
const STORAGE_PRESET_KEY = 'theysay_grid_preset';
const STORAGE_GRID_LAYOUT_KEY = 'theysay_grid_layout';
const STORAGE_THEME_KEY = 'theysay_theme';
const STORAGE_LAST_FETCH_KEY = 'theysay_last_fetch_time';

// UI Elements - Global
const btnLoginStatus = document.getElementById('btn-login-status');
const loginStatusText = document.getElementById('login-status-text');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const layoutSelect = document.getElementById('layout-select');
const btnMarkAllRead = document.getElementById('btn-mark-all-read');
const gridContainer = document.getElementById('grid-stack-container');
const bgWebviewsContainer = document.getElementById('bg-webviews-container');

let grid = null;
let currentRows = 2;
let currentCols = 2;

// Slots Data Registry
const slots = [];

// ----------------------------------------------------
// Toast Notification
// ----------------------------------------------------
function showToast(message, type = 'warning', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  const icon = type === 'warning' ? '⚠️' : (type === 'error' ? '❌' : (type === 'success' ? '✅' : 'ℹ️'));
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 250);
  }, duration);
}

// ----------------------------------------------------
// Theme Management
// ----------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_THEME_KEY, theme);
  if (btnThemeToggle) {
    btnThemeToggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    btnThemeToggle.title = theme === 'light' ? '切换深色模式' : '切换浅色模式';
  }
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_THEME_KEY) || 'dark';
  applyTheme(saved);

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }
}

// ----------------------------------------------------
// Human-like Jitter Utilities
// ----------------------------------------------------
function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// ----------------------------------------------------
// LocalStorage Persistence
// ----------------------------------------------------
function getSavedHandles() {
  try {
    const raw = localStorage.getItem(STORAGE_HANDLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return DEFAULT_HANDLES;
}

function saveHandles() {
  const current = slots.map(s => (s.handleInput ? s.handleInput.value.trim() : ''));
  localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(current));
}

function formatFetchTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${hours}:${minutes}:${seconds}`;
}

function updateSlotFetchTimeUI(slot, timestamp) {
  if (!slot) return;
  const timeStr = formatFetchTime(timestamp);
  if (slot.btnFetch) {
    slot.btnFetch.title = timeStr ? `上次抓取: ${timeStr} (点击立即刷新)` : '刷新推文';
  }
  if (slot.authorHeader) {
    const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
    slot.authorHeader.title = timeStr ? `@${handle} · 上次抓取: ${timeStr} (点击修改账号)` : '点击修改账号';
  }
}

function saveSlotCache(slotIndex, data) {
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    if (data) {
      cache[slotIndex] = {
        ...data,
        lastFetchedAt: data.lastFetchedAt || (slots[slotIndex] && slots[slotIndex].lastFetchedAt) || null
      };
    } else {
      delete cache[slotIndex];
    }
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function updateSlotAvatar(slot, avatarUrl) {
  if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim()) {
    // Automatically upgrade Twitter avatar to high-resolution 400x400 if it was normal
    const upgraded = avatarUrl.includes('_normal.') ? avatarUrl.replace('_normal.', '_400x400.') : avatarUrl;
    slot.avatarImg.src = upgraded;
    slot.avatarImg.style.display = 'block';
    slot.avatarPlaceholder.style.display = 'none';
  } else {
    slot.avatarImg.src = '';
    slot.avatarImg.style.display = 'none';
    slot.avatarPlaceholder.style.display = 'flex';
  }
}

function loadSlotCache() {
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    if (raw) {
      const cache = JSON.parse(raw);
      let hasCacheFix = false;
      slots.forEach(slot => {
        if (cache[slot.index]) {
          let { tweets, handle, avatarUrl, lastFetchedAt } = cache[slot.index];
          const cleanHandle = String(handle || '').replace(/^@/, '').toLowerCase().trim();

          // Auto-correct mismatched OpenAI avatars from past bug
          if (cleanHandle && cleanHandle !== 'openai') {
            if (avatarUrl && (avatarUrl.includes('ztsaR0JW') || avatarUrl.includes('1885410181409820672'))) {
              if (cleanHandle === 'sama') {
                avatarUrl = 'https://pbs.twimg.com/profile_images/2046764873200394240/r7BxVezs_400x400.jpg';
              } else if (cleanHandle === 'karpathy') {
                avatarUrl = 'https://pbs.twimg.com/profile_images/1296667294148382721/9Pr6XrPB_400x400.jpg';
              } else {
                avatarUrl = `https://unavatar.io/x/${cleanHandle}`;
              }
              cache[slot.index].avatarUrl = avatarUrl;
              hasCacheFix = true;
            }
          }

          if (lastFetchedAt) {
            slot.lastFetchedAt = lastFetchedAt;
            updateSlotFetchTimeUI(slot, lastFetchedAt);
          }
          if (avatarUrl) {
            updateSlotAvatar(slot, avatarUrl);
          }
          if (Array.isArray(tweets) && tweets.length > 0) {
            slot.monitoredHandle = handle;
            const sorted = processAndSortTweets(tweets);
            renderSlotTweets(slot, sorted, handle, avatarUrl);
          }
        }
      });
      if (hasCacheFix) {
        localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
      }
    }
  } catch (e) {}
}

function saveGridLayout() {
  if (!grid) return;
  try {
    const layoutData = grid.save(false);
    localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, JSON.stringify(layoutData));
  } catch (e) {}
}

// ----------------------------------------------------
// Background Webviews Pool (Pre-initialized & dom-ready tracking)
// ----------------------------------------------------
function initBackgroundWebviews() {
  bgWebviewsContainer.innerHTML = '';
  // Pre-initialize background webviews for all MAX_SLOTS so they attach to DOM and emit dom-ready upfront
  for (let i = 0; i < MAX_SLOTS; i++) {
    getOrCreateSlotWebview(i);
  }
}

function getOrCreateSlotWebview(slotIndex) {
  let wv = document.getElementById(`x-bg-webview-${slotIndex}`);
  if (!wv) {
    wv = document.createElement('webview');
    wv.id = `x-bg-webview-${slotIndex}`;
    wv.src = 'about:blank';
    wv.setAttribute('partition', 'persist:x_session');
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });

    bgWebviewsContainer.appendChild(wv);
    if (slots[slotIndex]) {
      slots[slotIndex].bgWebview = wv;
    }
  }
  return wv;
}

function waitForWebviewReady(wv) {
  if (!wv) return Promise.resolve();
  if (wv._isReady) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const onReady = () => {
      if (!done) {
        done = true;
        wv._isReady = true;
        resolve();
      }
    };
    wv.addEventListener('dom-ready', onReady, { once: true });
    setTimeout(onReady, 2000);
  });
}

function loadWebviewTarget(wv, targetUrl) {
  return new Promise((resolve) => {
    let done = false;
    const onReady = () => {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-fail-load', onReady);
    };

    wv.addEventListener('dom-ready', onReady, { once: true });
    wv.addEventListener('did-fail-load', onReady, { once: true });

    // Fallback timeout in case dom-ready doesn't fire or page load delays
    setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    }, 6000);

    try {
      wv.loadURL(targetUrl);
    } catch (e) {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    }
  });
}

// ----------------------------------------------------
// Slot DOM Element Generator
// ----------------------------------------------------
function createSlotWidget(index) {
  const widget = document.createElement('div');
  widget.className = 'grid-stack-item';
  widget.setAttribute('gs-id', `slot-${index}`);
  widget.setAttribute('data-slot-index', index);

  widget.innerHTML = `
    <div class="grid-stack-item-content">
      <div class="slot-card" id="slot-card-${index}">
        <!-- Compact Header (~34px) with User Avatar & Identity -->
        <div class="slot-header slot-drag-handle">
          <span class="slot-drag-indicator" title="按住拖拽卡片">⠿</span>

          <!-- User Profile Avatar in Header -->
          <div class="slot-avatar" id="slot-avatar-${index}" title="用户头像">
            <img class="slot-avatar-img" id="slot-avatar-img-${index}" alt="" style="display: none;">
            <span class="slot-avatar-placeholder" id="slot-avatar-placeholder-${index}">👤</span>
          </div>

          <!-- Identity Area: Displays Author Name / Handle next to Avatar, or Input Field -->
          <div class="slot-identity-area" id="slot-identity-${index}">
            <!-- Author display badge next to avatar (shown when tweets loaded) -->
            <div class="slot-author-header" id="slot-author-header-${index}" style="display: none;" title="点击修改账号">
              <span class="slot-author-name" id="author-name-${index}"></span>
              <span class="slot-author-handle" id="author-handle-${index}"></span>
              <span class="slot-author-edit-hint" title="修改">✎</span>
            </div>

            <!-- Handle input field (shown initially or when editing) -->
            <div class="slot-input-wrapper" id="slot-input-wrapper-${index}">
              <span class="slot-input-prefix">@</span>
              <input type="text" class="slot-handle-input" id="handle-input-${index}" placeholder="Twitter 用户名" autocomplete="off" spellcheck="false">
              <button class="slot-btn-clear" id="btn-clear-${index}" title="清空" style="display: none;">✕</button>
            </div>
          </div>

          <button class="slot-btn-fetch" id="btn-fetch-${index}" title="刷新推文">
            <svg class="refresh-icon" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
          <button class="slot-btn-expand" id="btn-expand-${index}" title="调整格子尺寸 (1×1, 2×1, 3×1, 2×2)">
            <span class="expand-icon" id="expand-icon-${index}">
              <svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="3" y2="21"></line>
              </svg>
            </span>
          </button>
          <!-- Size Options Dropdown Popover Menu -->
          <div class="slot-size-menu" id="size-menu-${index}" style="display: none;"></div>
        </div>

        <!-- Scrollable Content Viewport -->
        <div class="slot-content-container" id="slot-content-${index}">
          <div class="slot-placeholder" id="slot-placeholder-${index}">
            <span class="slot-placeholder-icon">💬</span>
            <p>输入 handle 并按回车或点击刷新</p>
          </div>
          <div class="slot-loading" id="slot-loading-${index}" style="display: none;">
            <div class="spinner-small"></div>
            <span class="slot-loading-text" id="slot-loading-text-${index}">后台抓取中...</span>
          </div>
          <div class="slot-error" id="slot-error-${index}" style="display: none;"></div>
          <div class="slot-tweets-list" id="slot-tweets-list-${index}" style="display: none;"></div>
        </div>
      </div>
    </div>
  `;

  return widget;
}

// ----------------------------------------------------
// GridStack Initialization & Layout Management
// ----------------------------------------------------
function calculateCellHeight(rows) {
  const availableHeight = window.innerHeight - 70; // top nav + padding
  const margin = 8;
  const totalMargin = (rows - 1) * margin;
  return Math.max(160, Math.floor((availableHeight - totalMargin) / rows));
}

function initSlotsRegistry() {
  const savedHandles = getSavedHandles();

  for (let i = 0; i < MAX_SLOTS; i++) {
    const el = createSlotWidget(i);
    const slot = {
      index: i,
      element: el,
      card: el.querySelector(`#slot-card-${i}`),
      bgWebview: getOrCreateSlotWebview(i),
      avatarContainer: el.querySelector(`#slot-avatar-${i}`),
      avatarImg: el.querySelector(`#slot-avatar-img-${i}`),
      avatarPlaceholder: el.querySelector(`#slot-avatar-placeholder-${i}`),
      identityArea: el.querySelector(`#slot-identity-${i}`),
      authorHeader: el.querySelector(`#slot-author-header-${i}`),
      authorName: el.querySelector(`#author-name-${i}`),
      authorHandle: el.querySelector(`#author-handle-${i}`),
      inputWrapper: el.querySelector(`#slot-input-wrapper-${i}`),
      handleInput: el.querySelector(`#handle-input-${i}`),
      btnClear: el.querySelector(`#btn-clear-${i}`),
      btnFetch: el.querySelector(`#btn-fetch-${i}`),
      btnExpand: el.querySelector(`#btn-expand-${i}`),
      expandIcon: el.querySelector(`#expand-icon-${i}`),
      sizeMenu: el.querySelector(`#size-menu-${i}`),
      contentContainer: el.querySelector(`#slot-content-${i}`),
      placeholder: el.querySelector(`#slot-placeholder-${i}`),
      loading: el.querySelector(`#slot-loading-${i}`),
      loadingText: el.querySelector(`#slot-loading-text-${i}`),
      error: el.querySelector(`#slot-error-${i}`),
      tweetsList: el.querySelector(`#slot-tweets-list-${i}`),
      isFetching: false,
      loadedTweets: []
    };

    slot.avatarImg.addEventListener('error', () => {
      if (slot.avatarImg.src.includes('_400x400.')) {
        slot.avatarImg.src = slot.avatarImg.src.replace('_400x400.', '_normal.');
      } else {
        slot.avatarImg.style.display = 'none';
        slot.avatarPlaceholder.style.display = 'flex';
      }
    });

    // Pre-fill saved handle
    if (savedHandles[i]) {
      slot.handleInput.value = savedHandles[i];
    }
    slot.monitoredHandle = savedHandles[i] || '';

    bindSlotEvents(slot);
    slots.push(slot);
  }
}

function bindSlotEvents(slot) {
  const updateClearVisibility = () => {
    if (slot.btnClear) {
      slot.btnClear.style.display = slot.handleInput.value.trim().length > 0 ? 'flex' : 'none';
    }
  };

  // Click author badge to switch to input edit mode
  slot.authorHeader.addEventListener('click', (e) => {
    e.stopPropagation();
    slot.authorHeader.style.display = 'none';
    slot.inputWrapper.style.display = 'flex';
    slot.handleInput.focus();
    slot.handleInput.select();
    updateClearVisibility();
  });

  // When handleInput loses focus or escape is pressed, revert to author badge if tweets exist
  slot.handleInput.addEventListener('blur', () => {
    const val = slot.handleInput.value.trim();
    if (val && slot.loadedTweets && slot.loadedTweets.length > 0 && slot.authorName.innerText.trim()) {
      slot.authorHeader.style.display = 'flex';
      slot.inputWrapper.style.display = 'none';
    }
  });

  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (slot.loadedTweets && slot.loadedTweets.length > 0 && slot.authorName.innerText.trim()) {
        slot.authorHeader.style.display = 'flex';
        slot.inputWrapper.style.display = 'none';
      }
    }
  });

  // Input changes
  slot.handleInput.addEventListener('input', () => {
    saveHandles();
    updateClearVisibility();
  });
  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchSlot(slot.index);
  });
  updateClearVisibility();

  // Clear handle button
  slot.btnClear.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSlot(slot);
  });

  // Fetch button
  slot.btnFetch.addEventListener('click', () => fetchSlot(slot.index));

  // Expand / Size Menu trigger
  slot.btnExpand.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSlotSizeMenu(slot);
  });
}

// ----------------------------------------------------
// Slot Size Options & Collision Check
// ----------------------------------------------------
function closeAllSizeMenus() {
  slots.forEach(s => {
    if (s.sizeMenu) s.sizeMenu.style.display = 'none';
  });
}

function clearSlot(slot) {
  slot.handleInput.value = '';
  if (slot.btnClear) slot.btnClear.style.display = 'none';
  updateSlotAvatar(slot, null);
  saveHandles();
  saveSlotCache(slot.index, null);
  slot.loadedTweets = [];
  slot.monitoredHandle = '';
  slot.tweetsList.innerHTML = '';
  slot.tweetsList.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.placeholder.style.display = 'flex';
  slot.authorName.innerText = '';
  slot.authorHandle.innerText = '';
  if (slot.authorHeader) slot.authorHeader.style.display = 'none';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
  showToast('已清空此栏内容与推文缓存', 'success', 2000);
}

function slotHasContent(slot) {
  if (!slot) return false;
  const handle = slot.handleInput ? slot.handleInput.value.trim() : '';
  const hasTweets = (slot.loadedTweets && slot.loadedTweets.length > 0);
  return handle.length > 0 || hasTweets;
}

function updateSlotSizeUI(slot, w, h) {
  const r = h; // 行
  const c = w; // 列
  const isExpanded = (r > 1 || c > 1);

  if (isExpanded) {
    slot.card.classList.add('is-priority');
    slot.btnExpand.classList.add('expanded');
    if (r > 1 && c === 1) {
      slot.expandIcon.innerHTML = `<svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 7 12 2 17 7"></polyline><polyline points="7 17 12 22 17 17"></polyline><line x1="12" y1="2" x2="12" y2="22"></line></svg>`;
    } else if (c > 1 && r === 1) {
      slot.expandIcon.innerHTML = `<svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 7 2 12 7 17"></polyline><polyline points="17 7 22 12 17 17"></polyline><line x1="2" y1="12" x2="22" y2="12"></line></svg>`;
    } else {
      slot.expandIcon.innerHTML = `<svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
    }
    slot.btnExpand.title = `当前尺寸: ${r}×${c} (点击切换或还原)`;
  } else {
    slot.card.classList.remove('is-priority');
    slot.btnExpand.classList.remove('expanded');
    slot.expandIcon.innerHTML = `<svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="3" y2="21"></line></svg>`;
    slot.btnExpand.title = '调整卡片尺寸 (1×1, 2×1, 3×1, 2×2)';
  }
}

function toggleSlotSizeMenu(slot) {
  const isOpen = slot.sizeMenu.style.display === 'flex';
  closeAllSizeMenus();
  if (isOpen) return;

  const node = slot.element.gridstackNode;
  const curR = node ? (node.h || 1) : 1; // 行在前
  const curC = node ? (node.w || 1) : 1; // 列在后
  const curKey = `${curR}x${curC}`;

  // 1×1, 2×1, 3×1, 2×2：行在前，列在后
  const options = [
    { r: 1, c: 1, label: '1 × 1', desc: '单格默认' },
    { r: 2, c: 1, label: '2 × 1', desc: '纵向双行' },
    { r: 3, c: 1, label: '3 × 1', desc: '纵向三行' },
    { r: 2, c: 2, label: '2 × 2', desc: '双行双列' }
  ];

  let menuHtml = `<div class="size-menu-title">调整卡片尺寸 (行 × 列)</div>`;

  options.forEach(opt => {
    const key = `${opt.r}x${opt.c}`;
    const isActive = (curKey === key);
    const disabled = (opt.r > currentRows || opt.c > currentCols);
    let hint = opt.desc;
    if (opt.r > currentRows) hint = `(需≥${opt.r}行)`;
    else if (opt.c > currentCols) hint = `(需≥${opt.c}列)`;

    menuHtml += `
      <button class="size-menu-item ${isActive ? 'active' : ''}" data-r="${opt.r}" data-c="${opt.c}" ${disabled ? 'style="opacity: 0.45;"' : ''}>
        <div>
          <span class="size-label">${opt.label}</span>
          <span class="size-desc">${hint}</span>
        </div>
        ${isActive ? '<span class="size-check">✓</span>' : ''}
      </button>
    `;
  });

  menuHtml += `
    <div class="size-menu-divider"></div>
    <button class="size-menu-item danger" data-action="clear">
      <div>
        <span class="size-label">清空本栏</span>
        <span class="size-desc">清除 Handle 与推文</span>
      </div>
      <span>🗑️</span>
    </button>
  `;

  slot.sizeMenu.innerHTML = menuHtml;
  slot.sizeMenu.style.display = 'flex';

  // Bind menu item clicks
  slot.sizeMenu.querySelectorAll('.size-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllSizeMenus();
      const action = item.getAttribute('data-action');
      if (action === 'clear') {
        clearSlot(slot);
        return;
      }
      const targetR = parseInt(item.getAttribute('data-r'), 10);
      const targetC = parseInt(item.getAttribute('data-c'), 10);
      // 行在前 (targetR = h), 列在后 (targetC = w)
      requestSlotResize(slot, targetC, targetR);
    });
  });
}

function requestSlotResize(slot, targetW, targetH) {
  if (!grid) return;
  const node = slot.element.gridstackNode;
  if (!node) return;

  // Already at target size
  if (node.w === targetW && node.h === targetH) {
    return;
  }

  // Restoring to 1x1 is always allowed
  if (targetW === 1 && targetH === 1) {
    grid.update(slot.element, { w: 1, h: 1 });
    updateSlotSizeUI(slot, 1, 1);
    saveGridLayout();
    return;
  }

  // Check if grid capacity is sufficient (targetH is rows, targetW is cols)
  if (targetW > currentCols) {
    showToast(`当前网格仅有 ${currentCols} 列，无法容纳 ${targetW} 列宽度的卡片。请先在顶部切换更大列数的网格布局。`, 'warning', 4500);
    return;
  }
  if (targetH > currentRows) {
    showToast(`当前网格仅有 ${currentRows} 行，无法容纳 ${targetH} 行高度的卡片。请先在顶部切换更多行的网格布局。`, 'warning', 4500);
    return;
  }

  // Determine target coordinates in the grid (stay in bounds)
  let targetX = node.x;
  let targetY = node.y;

  if (targetX + targetW > currentCols) {
    targetX = Math.max(0, currentCols - targetW);
  }
  if (targetY + targetH > currentRows) {
    targetY = Math.max(0, currentRows - targetH);
  }

  // Collision detection: Check if any other slots inside target rectangle have content
  const conflicts = [];
  const totalSlots = currentRows * currentCols;

  for (let i = 0; i < totalSlots; i++) {
    const otherSlot = slots[i];
    if (otherSlot.index === slot.index) continue;
    if (!otherSlot.element.parentElement) continue;
    const otherNode = otherSlot.element.gridstackNode;
    if (!otherNode) continue;

    // Check if otherNode intersects with [targetX, targetX + targetW) x [targetY, targetY + targetH)
    const overlaps = (
      otherNode.x < targetX + targetW &&
      otherNode.x + otherNode.w > targetX &&
      otherNode.y < targetY + targetH &&
      otherNode.y + otherNode.h > targetY
    );

    if (overlaps && slotHasContent(otherSlot)) {
      conflicts.push(otherSlot);
    }
  }

  if (conflicts.length > 0) {
    // Shake and highlight conflicting slots in red
    conflicts.forEach(c => {
      c.card.classList.remove('slot-card-conflict');
      void c.card.offsetWidth; // force DOM reflow
      c.card.classList.add('slot-card-conflict');
      setTimeout(() => c.card.classList.remove('slot-card-conflict'), 1800);
    });

    const conflictNames = conflicts.map(c => {
      const h = c.handleInput.value.trim();
      return h ? `@${h}` : `卡片`;
    }).join('、');

    showToast(`⚠️ 无法放大为 ${targetH}×${targetW}：周边格子 (${conflictNames}) 已有内容。请先将周边的格子移开，或把它们清除掉后再试。`, 'warning', 5000);
    return;
  }

  // No content conflict! Update widget position & dimensions
  grid.update(slot.element, { x: targetX, y: targetY, w: targetW, h: targetH });
  updateSlotSizeUI(slot, targetW, targetH);
  saveGridLayout();
}

function applyGridLayout(rows, cols, resetPositions = false) {
  currentRows = rows;
  currentCols = cols;

  grid.column(cols);
  grid.cellHeight(calculateCellHeight(rows));

  const totalSlots = rows * cols;

  // 1. Remove widgets beyond totalSlots from GridStack and DOM
  for (let i = totalSlots; i < MAX_SLOTS; i++) {
    const slot = slots[i];
    if (slot.element.parentElement) {
      try {
        grid.removeWidget(slot.element, true, false);
      } catch (e) {}
      if (slot.element.parentElement) {
        slot.element.remove();
      }
    }
    updateSlotSizeUI(slot, 1, 1);
  }

  // 2. Attach and position active slots
  for (let i = 0; i < totalSlots; i++) {
    const slot = slots[i];
    const isAttached = !!slot.element.parentElement;
    const col = i % cols;
    const row = Math.floor(i / cols);

    if (!isAttached) {
      gridContainer.appendChild(slot.element);
      grid.makeWidget(slot.element);
      grid.update(slot.element, { x: col, y: row, w: 1, h: 1 });
      updateSlotSizeUI(slot, 1, 1);
    } else if (resetPositions || !slot.element.gridstackNode) {
      grid.update(slot.element, { x: col, y: row, w: 1, h: 1 });
      updateSlotSizeUI(slot, 1, 1);
    }
  }

  // 3. Purge any orphan elements that do not belong to active slots
  const activeElements = new Set(slots.slice(0, totalSlots).map(s => s.element));
  Array.from(gridContainer.children).forEach(child => {
    if (!activeElements.has(child)) {
      try {
        grid.removeWidget(child, true, false);
      } catch (e) {}
      if (child.parentElement) {
        child.remove();
      }
    }
  });

  saveGridLayout();
}

function parsePreset(presetStr) {
  const [r, c] = presetStr.split('x').map(Number);
  return { rows: r || 2, cols: c || 2 };
}

// ----------------------------------------------------
// Tweet Key, Timestamp & Chronological Sorting Utilities
// ----------------------------------------------------
function getTweetId(tweet) {
  if (tweet.id) return String(tweet.id);
  if (tweet.url) {
    const m = String(tweet.url).match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  return '';
}

function getTweetTimestamp(tweet) {
  if (typeof tweet.timestamp === 'number' && tweet.timestamp > 0) {
    return tweet.timestamp;
  }
  if (tweet.datetime) {
    const parsed = Date.parse(tweet.datetime);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const id = getTweetId(tweet);
  if (id) {
    try {
      return Number((BigInt(id) >> 22n) + 1288834974657n);
    } catch (e) {}
  }
  return 0;
}

function getTweetKey(tweet) {
  const id = getTweetId(tweet);
  if (id) return `id_${id}`;
  if (tweet.url) return `url_${tweet.url}`;
  return `txt_${(tweet.text || '').slice(0, 40)}_${tweet.time || ''}`;
}

function processAndSortTweets(tweets) {
  if (!Array.isArray(tweets) || tweets.length === 0) return [];

  // 1. Ensure id and timestamp are calculated
  const normalized = tweets.map(t => ({
    ...t,
    id: getTweetId(t),
    timestamp: getTweetTimestamp(t)
  }));

  // 2. Deduplicate by unique key
  const uniqueMap = new Map();
  for (const t of normalized) {
    const key = getTweetKey(t);
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, t);
    }
  }
  const uniqueTweets = Array.from(uniqueMap.values());

  // 3. Separate non-pinned and pinned tweets
  const nonPinned = uniqueTweets.filter(t => !t.isPinned);
  const pinned = uniqueTweets.filter(t => t.isPinned);

  // 4. "如果置顶的帖子比最老的帖子还老，那就不显示它"
  let validPinned = [];
  if (nonPinned.length > 0) {
    let oldestNonPinnedTime = Infinity;
    for (const t of nonPinned) {
      if (t.timestamp > 0 && t.timestamp < oldestNonPinnedTime) {
        oldestNonPinnedTime = t.timestamp;
      }
    }

    validPinned = pinned.filter(p => {
      // If pinned post is older than the oldest non-pinned post, drop it!
      if (oldestNonPinnedTime !== Infinity && p.timestamp > 0) {
        return p.timestamp >= oldestNonPinnedTime;
      }
      return true;
    });
  } else {
    validPinned = pinned;
  }

  // 5. "从上到下是从旧到新（升序排序，最新推文在最下面）"
  const combined = [...validPinned, ...nonPinned];
  combined.sort((a, b) => {
    const timeA = a.timestamp || 0;
    const timeB = b.timestamp || 0;
    if (timeA !== timeB) {
      return timeA - timeB; // 升序：时间早的在前(上)，时间晚(新)的在后(下)
    }
    // Fallback: compare Snowflake IDs
    if (a.id && b.id) {
      try {
        const diff = BigInt(a.id) - BigInt(b.id);
        return diff > 0n ? 1 : (diff < 0n ? -1 : 0);
      } catch (e) {}
    }
    return 0;
  });

  return combined;
}

function getTweetDateObj(tweet) {
  if (tweet.datetime) {
    try {
      const d = new Date(tweet.datetime);
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}
  }
  if (typeof tweet.timestamp === 'number' && tweet.timestamp > 0) {
    const d = new Date(tweet.timestamp);
    if (!isNaN(d.getTime())) return d;
  }
  const ts = getTweetTimestamp(tweet);
  if (ts && ts > 0) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  if (tweet.time) {
    const parsed = Date.parse(tweet.time);
    if (!isNaN(parsed) && parsed > 0) {
      return new Date(parsed);
    }
  }
  return null;
}

function getTweetDateKey(tweet) {
  const d = getTweetDateObj(tweet);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTweetDateLabel(tweet) {
  const d = getTweetDateObj(tweet);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatTelegramTime(tweet) {
  const d = getTweetDateObj(tweet);
  if (d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return tweet.time || '';
}

// ----------------------------------------------------
// UI Render Helpers
// ----------------------------------------------------
function showSlotLoading(slot, text) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'flex';
  slot.loadingText.innerText = text;
  slot.error.style.display = 'none';
  slot.tweetsList.style.display = 'none';
}

function showSlotError(slot, errorMsg) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'block';
  slot.error.innerHTML = `⚠️ ${errorMsg}`;
  slot.tweetsList.style.display = 'none';
}

function renderSlotTweets(slot, tweets, handle, avatarUrl = null) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.tweetsList.style.display = 'flex';

  slot.loadedTweets = tweets;

  const firstTweet = tweets[0] || {};
  const displayName = (firstTweet.displayName || '').trim();
  const userHandle = (firstTweet.userHandle || `@${handle}`).trim();

  // Set author name next to avatar
  if (displayName && displayName !== userHandle && displayName !== handle) {
    slot.authorName.innerText = displayName;
    slot.authorHandle.innerText = userHandle;
  } else {
    slot.authorName.innerText = userHandle || `@${handle}`;
    slot.authorHandle.innerText = '';
  }

  // Switch to author badge view in header
  if (slot.authorHeader) slot.authorHeader.style.display = 'flex';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'none';

  // Update header avatar
  if (avatarUrl) {
    updateSlotAvatar(slot, avatarUrl);
  }

  slot.tweetsList.innerHTML = '';

  const finalAvatar = avatarUrl || (slot.avatarImg && slot.avatarImg.src) || '';
  const cleanHandle = String(handle || '').replace(/^@/, '').trim();

  let lastDateKey = null;

  tweets.forEach((tweet) => {
    const dateKey = getTweetDateKey(tweet);
    const dateLabel = getTweetDateLabel(tweet);

    if (dateKey && dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      const dateDivider = document.createElement('div');
      dateDivider.className = 'im-date-divider';
      dateDivider.innerHTML = `<span class="im-date-pill">${escapeHtml(dateLabel)}</span>`;
      slot.tweetsList.appendChild(dateDivider);
    }

    const bubble = document.createElement('div');
    bubble.className = 'im-bubble';
    if (tweet.isUnread) {
      bubble.classList.add('unread');
    }

    // Restore to normal bubble color once hovered
    bubble.addEventListener('mouseenter', () => {
      if (bubble.classList.contains('unread')) {
        bubble.classList.remove('unread');
        tweet.isUnread = false;
        saveSlotCache(slot.index, { handle, displayName, userHandle, tweets, avatarUrl: finalAvatar });
      }
    });

    let tagHtml = '';
    if (tweet.isPinned) tagHtml += '<span class="tweet-tag">置顶</span>';
    if (tweet.isRetweet) tagHtml += '<span class="tweet-tag repost">转推</span>';

    // Clean whitespace and character truncation for long tweets (> 100 characters)
    const rawText = (tweet.text || '').trim();
    const chars = Array.from(rawText);
    const isLong = chars.length > 100;
    const previewText = isLong ? chars.slice(0, 100).join('') : rawText;
    const timeDisplay = formatTelegramTime(tweet);

    let textHtml = '';
    if (isLong) {
      textHtml = `<span class="im-text-content"><span class="im-text-preview">${escapeHtml(previewText)}<span class="im-text-ellipsis">...</span></span><span class="im-text-full">${escapeHtml(rawText)}</span></span>`;
    } else {
      textHtml = `<span class="im-text-content">${escapeHtml(rawText)}</span>`;
    }

    bubble.innerHTML = `${tagHtml}${textHtml}<span class="im-time">${escapeHtml(timeDisplay)}</span>${tweet.url ? `<a class="im-btn-link" data-url="${escapeHtml(tweet.url)}" title="在浏览器中打开原推文">↗</a>` : ''}`;

    // Open external tweet link (hover button in top-right)
    if (tweet.url) {
      const linkBtn = bubble.querySelector('.im-btn-link');
      if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
          e.preventDefault();
          shell.openExternal(tweet.url);
        });
      }
    }

    slot.tweetsList.appendChild(bubble);
  });

  // Auto-scroll to bottom to show the latest tweets (Telegram style)
  requestAnimationFrame(() => {
    if (slot.contentContainer) {
      slot.contentContainer.scrollTop = slot.contentContainer.scrollHeight;
    }
  });

  saveSlotCache(slot.index, { handle, displayName, userHandle, tweets, avatarUrl: finalAvatar });
}

// ----------------------------------------------------
// Parallel Scraping with Jitter & Anti-Bot Protection
// ----------------------------------------------------
function buildExtractionScript(handle) {
  const cleanHandle = String(handle || '').replace(/^@/, '').toLowerCase().trim();
  return `
  (() => {
    try {
      const targetHandle = ${JSON.stringify(cleanHandle)};
      const bodyText = document.body ? document.body.innerText : '';
      
      if (bodyText.includes("Rate limit exceeded") || bodyText.includes("超出频率限制")) {
        return { error: '已触碰 Twitter 频率限制 (Rate limit exceeded)，请稍候 10~15 分钟再试' };
      }
      if (document.querySelector('iframe[src*="arkose"]') || document.querySelector('iframe[src*="challenge"]') || bodyText.includes("Confirm you’re human") || bodyText.includes("请确认您是真人")) {
        return { error: 'Twitter 要求进行人机验证，请点击右上角【登录 X】在弹出窗口中手动完成验证' };
      }

      if (bodyText.includes("This account doesn’t exist") || bodyText.includes("此账号不存在")) {
        return { error: '该账号不存在 (Account does not exist)' };
      }
      if (bodyText.includes("Account suspended") || bodyText.includes("账号已被冻结")) {
        return { error: '该账号已被冻结 (Account suspended)' };
      }
      if (bodyText.includes("These posts are protected") || bodyText.includes("这些帖子已受保护") || bodyText.includes("此账号已设置私密")) {
        return { error: '该账号为私密账号，推文已受保护' };
      }
      if (location.pathname.includes('/login') || location.pathname.includes('/i/flow/login')) {
        return { error: '尚未登录 X 账号，请先点击右上角登录' };
      }

      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article'));
      if (!articles || articles.length === 0) {
        return { pending: true };
      }

      // Extract user profile avatar URL strictly matching targetHandle
      let avatarUrl = '';

      if (targetHandle) {
        // 1. Check profile header photo link: <a href="/handle/photo"> or <a href="/handle/photo?xxx">
        const photoImgs = Array.from(document.querySelectorAll('a[href*="/photo"] img'));
        for (const img of photoImgs) {
          const a = img.closest('a');
          const href = a ? (a.getAttribute('href') || '') : '';
          // Make sure it is the target user's profile photo (e.g. /sama/photo) and not inside a tweet
          if (href.toLowerCase().includes('/' + targetHandle + '/photo') && !img.closest('article')) {
            if (img.src && !img.src.includes('default_profile')) {
              avatarUrl = img.src;
              break;
            }
          }
        }

        // 2. Check profile avatar by alt="@handle" or alt="handle" (excluding sidebar and recommendations)
        if (!avatarUrl) {
          const profileImgs = Array.from(document.querySelectorAll('img[src*="profile_images"]'));
          for (const img of profileImgs) {
            if (img.closest('aside') || img.closest('[data-testid="sidebarColumn"]')) continue;
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            if (alt === '@' + targetHandle || alt === targetHandle || alt.includes('@' + targetHandle)) {
              if (img.src && !img.src.includes('default_profile')) {
                avatarUrl = img.src;
                break;
              }
            }
          }
        }

        // 3. Check author's own tweet avatar: article where the avatar link specifically points to /handle
        if (!avatarUrl) {
          for (const article of articles) {
            const authorAvatarImg = article.querySelector(\`[data-testid="Tweet-User-Avatar"] a[href^="/\${targetHandle}" i] img, [data-testid="Tweet-User-Avatar"] a[href="/\${targetHandle}" i] img\`);
            if (authorAvatarImg && authorAvatarImg.src && !authorAvatarImg.src.includes('default_profile')) {
              avatarUrl = authorAvatarImg.src;
              break;
            }
          }
        }
      }

      // 4. Fallback: Generic profile header photo link (only in primaryColumn/header, NEVER in tweets or sidebar)
      if (!avatarUrl) {
        const headerImg = document.querySelector('header a[href$="/photo"] img, [data-testid="primaryColumn"] a[href$="/photo"] img, a[href$="/photo"] img');
        if (headerImg && !headerImg.closest('article') && !headerImg.closest('aside') && !headerImg.closest('[data-testid="sidebarColumn"]')) {
          if (headerImg.src && !headerImg.src.includes('default_profile')) {
            avatarUrl = headerImg.src;
          }
        }
      }

      const items = [];
      for (const article of articles) {
        const statusLink = article.querySelector('a[href*="/status/"]');
        const tweetUrl = statusLink ? statusLink.getAttribute('href') : '';
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const timeEl = article.querySelector('time');
        const userNameEl = article.querySelector('[data-testid="User-Name"]');

        let isPinned = false;
        let isRetweet = false;
        const socialContext = article.querySelector('[data-testid="socialContext"]');
        if (socialContext) {
          const scText = socialContext.innerText || '';
          if (scText.includes("Pinned") || scText.includes("置顶")) isPinned = true;
          if (scText.includes("reposted") || scText.includes("Retweeted") || scText.includes("转推")) isRetweet = true;
        } else {
          const topText = article.innerText.slice(0, 100);
          if (topText.includes("Pinned") || topText.includes("置顶")) isPinned = true;
          if (topText.includes("reposted") || topText.includes("Retweeted") || topText.includes("转推")) isRetweet = true;
        }

        let displayName = '';
        let userHandle = '';
        if (userNameEl) {
          const lines = userNameEl.innerText.split('\\\\n').filter(s => s.trim());
          if (lines.length > 0) displayName = lines[0];
          const foundHandle = lines.find(s => s.startsWith('@'));
          if (foundHandle) userHandle = foundHandle;
        }

        const text = textEl ? textEl.innerText.trim() : '(该推文为纯媒体/卡片内容，无文本)';
        const displayTime = timeEl ? timeEl.innerText.trim() : '';
        const datetime = timeEl ? (timeEl.getAttribute('datetime') || '') : '';

        items.push({
          url: tweetUrl ? ('https://x.com' + tweetUrl) : '',
          text: text,
          time: displayTime || datetime,
          datetime: datetime,
          displayName: displayName,
          userHandle: userHandle,
          isPinned: isPinned,
          isRetweet: isRetweet
        });
      }

      return { success: true, items: items, avatarUrl: avatarUrl };
    } catch (e) {
      return { error: e.message };
    }
  })()
  `;
}

async function fetchSlot(slotIndex, { isBackground = false } = {}) {
  const slot = slots[slotIndex];
  if (slot.isFetching) return;

  const rawHandle = slot.handleInput.value.trim();
  const handle = rawHandle.replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?(twitter|x)\.com\//, '').replace(/\/$/, '');

  if (!handle) {
    if (!isBackground) {
      showSlotError(slot, '请输入 Twitter handle');
      if (slot.authorHeader) slot.authorHeader.style.display = 'none';
      if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
      slot.handleInput.focus();
    }
    return;
  }

  saveHandles();

  slot.isFetching = true;
  slot.btnFetch.disabled = true;
  slot.btnFetch.classList.add('fetching');
  slot.btnFetch.title = '正在抓取推文...';

  // Check if we already have existing tweets for this exact handle
  const hasExisting = (slot.monitoredHandle === handle && Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0);
  const existingTweets = hasExisting ? slot.loadedTweets : [];
  const existingKeys = new Set(existingTweets.map(t => getTweetKey(t)));

  // In background mode with existing tweets, keep tweets visible and only spin the refresh icon
  if (!isBackground || !hasExisting) {
    showSlotLoading(slot, `正在后台抓取 @${handle}...`);
  }

  const targetUrl = `https://x.com/${handle}`;

  // Identify newest non-pinned tweet key as our timeline boundary (last element in ascending sort)
  const existingNonPinned = existingTweets.filter(t => !t.isPinned);
  const boundaryTweet = existingNonPinned.length > 0 ? existingNonPinned[existingNonPinned.length - 1] : null;
  const boundaryKey = boundaryTweet ? getTweetKey(boundaryTweet) : null;

  try {
    const bgWebview = getOrCreateSlotWebview(slotIndex);
    await waitForWebviewReady(bgWebview);
    await loadWebviewTarget(bgWebview, targetUrl);

    // Brief grace period for Twitter SPA hydration
    await sleep(400);

    const INITIAL_TARGET_COUNT = 5;
    const collectedNewTweets = [];
    const seenInThisRun = new Set();
    const maxAttempts = hasExisting ? 15 : 35;
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;
    let latestAvatarUrl = '';
    let reachedBoundary = false;

    while (attempts < maxAttempts) {
      attempts++;

      // Guard: do not execute script if webview is currently navigating
      if (typeof bgWebview.isLoading === 'function' && bgWebview.isLoading()) {
        await sleep(350);
        continue;
      }

      await sleep(randomBetween(450, 750));

      try {
        const extractionScript = buildExtractionScript(handle);
        const result = await bgWebview.executeJavaScript(extractionScript);

        if (result && result.error) {
          if (!isBackground || !hasExisting) {
            showSlotError(slot, result.error);
          } else {
            console.warn(`[Background Fetch] Error for @${handle}:`, result.error);
          }
          return;
        }

        if (result && result.avatarUrl) {
          const isHighRes = result.avatarUrl.includes('_400x400');
          if (!latestAvatarUrl || (isHighRes && !latestAvatarUrl.includes('_400x400'))) {
            latestAvatarUrl = result.avatarUrl;
            updateSlotAvatar(slot, latestAvatarUrl);
          }
        }

        if (result && result.success && Array.isArray(result.items)) {
          let foundNewOnThisScroll = 0;

          for (const item of result.items) {
            const key = getTweetKey(item);
            if (seenInThisRun.has(key)) continue;
            seenInThisRun.add(key);

            // Boundary detection: if this normal tweet was already fetched before
            if (hasExisting && !item.isPinned) {
              if (boundaryKey && key === boundaryKey) {
                reachedBoundary = true;
                break;
              }
              if (existingKeys.has(key)) {
                reachedBoundary = true;
                break;
              }
            }

            if (!existingKeys.has(key)) {
              item.isUnread = true;
              collectedNewTweets.push(item);
              foundNewOnThisScroll++;
            }
          }

          if (reachedBoundary) {
            break;
          }

          if (!hasExisting && collectedNewTweets.length >= INITIAL_TARGET_COUNT) {
            break;
          }

          if (foundNewOnThisScroll > 0) {
            consecutiveEmptyScrolls = 0;
            if (!isBackground || !hasExisting) {
              slot.loadingText.innerText = hasExisting
                ? `发现新推文 (${collectedNewTweets.length})...`
                : `已获取 (${collectedNewTweets.length}/${INITIAL_TARGET_COUNT})...`;
            }
          } else {
            consecutiveEmptyScrolls++;
          }

          const scrollDistance = randomBetween(650, 1050);
          await bgWebview.executeJavaScript(`window.scrollBy({ top: ${scrollDistance}, behavior: 'smooth' });`);
          await sleep(randomBetween(300, 600));

          if (consecutiveEmptyScrolls >= 5) {
            break;
          }
        }
      } catch (e) {
        // Ignore temporary navigation re-evaluation errors
      }
    }

    if (!latestAvatarUrl && handle) {
      latestAvatarUrl = `https://unavatar.io/x/${handle}`;
      updateSlotAvatar(slot, latestAvatarUrl);
    }

    slot.monitoredHandle = handle;
    slot.lastFetchedAt = Date.now();
    localStorage.setItem(STORAGE_LAST_FETCH_KEY, slot.lastFetchedAt.toString());
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);

    if (hasExisting) {
      if (collectedNewTweets.length === 0) {
        if (!isBackground) {
          showToast(`@${handle} 已是最新，暂无新推文`, 'info', 2000);
        }
        const sortedExisting = processAndSortTweets(existingTweets);
        renderSlotTweets(slot, sortedExisting, handle, latestAvatarUrl);
      } else {
        showToast(`@${handle} 抓取到 ${collectedNewTweets.length} 条新推文`, 'success', 2500);
        const merged = [...collectedNewTweets, ...existingTweets];
        const sorted = processAndSortTweets(merged);
        const finalTweets = sorted.slice(-20);
        renderSlotTweets(slot, finalTweets, handle, latestAvatarUrl);
      }
    } else {
      if (collectedNewTweets.length > 0) {
        const sorted = processAndSortTweets(collectedNewTweets);
        const finalTweets = sorted.slice(-20);
        renderSlotTweets(slot, finalTweets, handle, latestAvatarUrl);
      } else {
        if (!isBackground || !hasExisting) {
          showSlotError(slot, '抓取超时：未检测到推文。请确认右上角已登录，或该用户近期是否发过推文。');
        }
      }
    }
  } catch (err) {
    if (!isBackground || !hasExisting) {
      showSlotError(slot, `发生异常: ${err.message}`);
    } else {
      console.warn(`[Background Fetch] Exception for @${handle}:`, err);
    }
  } finally {
    slot.isFetching = false;
    slot.btnFetch.disabled = false;
    slot.btnFetch.classList.remove('fetching');
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
}

// ----------------------------------------------------
// Periodic Background Fetching (10-minute interval, sequential)
// ----------------------------------------------------
const BACKGROUND_FETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let isBackgroundFetching = false;
let backgroundFetchTimer = null;
let backgroundFetchTimeout = null;

async function runBackgroundFetch() {
  if (isBackgroundFetching) return;
  isBackgroundFetching = true;

  try {
    const totalSlots = currentRows * currentCols;
    for (let i = 0; i < totalSlots; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const raw = slot.handleInput ? slot.handleInput.value.trim() : '';
      const handle = raw.replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?(twitter|x)\.com\//, '').replace(/\/$/, '');
      if (handle && !slot.isFetching) {
        await fetchSlot(i, { isBackground: true });
        // Polite pause between sequential card crawls to avoid rapid bursts
        await sleep(1500);
      }
    }
  } catch (err) {
    console.error('[Background Fetch] Error during sequential crawl:', err);
  } finally {
    isBackgroundFetching = false;
  }
}

function startPeriodicBackgroundFetch() {
  if (backgroundFetchTimer) {
    clearInterval(backgroundFetchTimer);
    backgroundFetchTimer = null;
  }
  if (backgroundFetchTimeout) {
    clearTimeout(backgroundFetchTimeout);
    backgroundFetchTimeout = null;
  }

  const lastFetchRaw = localStorage.getItem(STORAGE_LAST_FETCH_KEY);
  const lastFetchTime = lastFetchRaw ? parseInt(lastFetchRaw, 10) : 0;
  const now = Date.now();
  const elapsed = lastFetchTime > 0 ? (now - lastFetchTime) : Infinity;

  // Never fetch immediately on page refresh!
  // If the last fetch was within the 10-minute interval, wait for the remaining time;
  // otherwise wait the full 10-minute cycle before starting the periodic background fetch.
  let delayUntilNext = BACKGROUND_FETCH_INTERVAL_MS;
  if (elapsed < BACKGROUND_FETCH_INTERVAL_MS) {
    delayUntilNext = Math.max(BACKGROUND_FETCH_INTERVAL_MS - elapsed, 30000);
  }

  backgroundFetchTimeout = setTimeout(() => {
    runBackgroundFetch();
    backgroundFetchTimer = setInterval(runBackgroundFetch, BACKGROUND_FETCH_INTERVAL_MS);
  }, delayUntilNext);
}

// ----------------------------------------------------
// Mark All Tweets As Read
// ----------------------------------------------------
function markAllTweetsAsRead() {
  let hasMarkedAny = false;
  slots.forEach(slot => {
    if (Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0) {
      let slotUpdated = false;
      slot.loadedTweets.forEach(t => {
        if (t.isUnread) {
          t.isUnread = false;
          slotUpdated = true;
          hasMarkedAny = true;
        }
      });
      if (slotUpdated) {
        saveSlotCache(slot.index, {
          handle: slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : ''),
          displayName: slot.authorName ? slot.authorName.innerText : '',
          userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
          tweets: slot.loadedTweets,
          avatarUrl: (slot.avatarImg && slot.avatarImg.src) || ''
        });
      }
    }
    if (slot.tweetsList) {
      const unreadBubbles = slot.tweetsList.querySelectorAll('.im-bubble.unread');
      if (unreadBubbles.length > 0) {
        unreadBubbles.forEach(b => b.classList.remove('unread'));
        hasMarkedAny = true;
      }
    }
  });

  if (hasMarkedAny) {
    showToast('已将所有推文标记为已读', 'success', 2000);
  } else {
    showToast('暂无未读推文', 'info', 1500);
  }
}

// ----------------------------------------------------
// Login Status & Popup Window Handling
// ----------------------------------------------------
function updateLoginUI(isLoggedIn) {
  btnLoginStatus.classList.remove('checking', 'logged-in', 'logged-out');
  if (isLoggedIn) {
    btnLoginStatus.classList.add('logged-in');
    loginStatusText.innerText = '已登录 X';
    btnLoginStatus.title = '点击重新登录或切换账号';
  } else {
    btnLoginStatus.classList.add('logged-out');
    loginStatusText.innerText = '🔑 登录 X 账号';
    btnLoginStatus.title = '点击弹出窗口登录 Twitter / X 账号';
  }
}

async function checkLoginStatus() {
  try {
    const isLoggedIn = await ipcRenderer.invoke('check-login-status');
    updateLoginUI(isLoggedIn);
  } catch (e) {
    updateLoginUI(false);
  }
}

btnLoginStatus.addEventListener('click', () => {
  ipcRenderer.send('open-login-window');
});

ipcRenderer.on('login-status-changed', (event, { loggedIn }) => {
  updateLoginUI(loggedIn);
});

// ----------------------------------------------------
// Lifecycle Initialization & Window Resize
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initBackgroundWebviews();
  initSlotsRegistry();
  checkLoginStatus();

  // Close size menus when clicking outside
  document.addEventListener('click', closeAllSizeMenus);

  // Initialize GridStack
  const savedPreset = localStorage.getItem(STORAGE_PRESET_KEY) || '2x2';
  layoutSelect.value = savedPreset;
  const { rows, cols } = parsePreset(savedPreset);

  grid = GridStack.init({
    column: cols,
    cellHeight: calculateCellHeight(rows),
    margin: 8,
    animate: true,
    float: false,
    handle: '.slot-drag-handle',
    resizable: {
      handles: 'e,se,s,sw,w'
    }
  });

  // Apply layout
  applyGridLayout(rows, cols, false);

  // Restore cached tweets
  loadSlotCache();

  // Save on layout changes (drag, resize) & synchronize size UI
  grid.on('change', (event, items) => {
    if (Array.isArray(items)) {
      items.forEach(item => {
        const idx = parseInt(item.el.getAttribute('data-slot-index'), 10);
        if (!isNaN(idx) && slots[idx]) {
          updateSlotSizeUI(slots[idx], item.w || 1, item.h || 1);
        }
      });
    }
    saveGridLayout();
  });

  // Layout preset dropdown change
  layoutSelect.addEventListener('change', () => {
    const val = layoutSelect.value;
    localStorage.setItem(STORAGE_PRESET_KEY, val);
    const { rows, cols } = parsePreset(val);
    applyGridLayout(rows, cols, true);
  });

  // Mark all tweets as read button
  btnMarkAllRead.addEventListener('click', markAllTweetsAsRead);

  // Responsive dynamic cellHeight on window resize
  window.addEventListener('resize', () => {
    if (grid) {
      grid.cellHeight(calculateCellHeight(currentRows));
    }
  });

  // Start periodic 10-minute background fetch
  startPeriodicBackgroundFetch();
});
