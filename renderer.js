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

// UI Elements - Global
const btnLoginStatus = document.getElementById('btn-login-status');
const loginStatusText = document.getElementById('login-status-text');
const btnFetchAll = document.getElementById('btn-fetch-all');
const btnFetchAllText = document.getElementById('btn-fetch-all-text');
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeToggleIcon = document.getElementById('theme-toggle-icon');
const themeToggleText = document.getElementById('theme-toggle-text');
const layoutSelect = document.getElementById('layout-select');
const btnResetLayout = document.getElementById('btn-reset-layout');
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
  if (theme === 'light') {
    if (themeToggleIcon) themeToggleIcon.innerText = '🌙';
    if (themeToggleText) themeToggleText.innerText = '深色';
    if (btnThemeToggle) btnThemeToggle.title = '切换深色模式';
  } else {
    if (themeToggleIcon) themeToggleIcon.innerText = '☀️';
    if (themeToggleText) themeToggleText.innerText = '浅色';
    if (btnThemeToggle) btnThemeToggle.title = '切换浅色模式';
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

function saveSlotCache(slotIndex, data) {
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[slotIndex] = data;
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function updateSlotAvatar(slot, avatarUrl) {
  if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim()) {
    slot.avatarImg.src = avatarUrl;
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
      slots.forEach(slot => {
        if (cache[slot.index]) {
          const { tweets, handle, avatarUrl } = cache[slot.index];
          if (avatarUrl) {
            updateSlotAvatar(slot, avatarUrl);
          }
          if (Array.isArray(tweets) && tweets.length > 0) {
            renderSlotTweets(slot, tweets, handle, avatarUrl);
          }
        }
      });
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
// Background Webviews Pool (Lazy Loaded)
// ----------------------------------------------------
function initBackgroundWebviews() {
  bgWebviewsContainer.innerHTML = '';
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
    bgWebviewsContainer.appendChild(wv);
    if (slots[slotIndex]) {
      slots[slotIndex].bgWebview = wv;
    }
  }
  return wv;
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

          <!-- Counter badge and quick copy in header -->
          <span class="slot-counter" id="slot-counter-${index}" style="display: none;">0 条</span>
          <button class="slot-btn-copy-all" id="btn-copy-all-${index}" title="复制本栏全部推文" style="display: none;">复制</button>

          <button class="slot-btn-fetch" id="btn-fetch-${index}">抓取</button>
          <button class="slot-btn-expand" id="btn-expand-${index}" title="调整格子尺寸 (1×1, 2×1, 3×1, 2×2)">
            <span class="expand-icon" id="expand-icon-${index}">⤢</span>
          </button>
          <!-- Size Options Dropdown Popover Menu -->
          <div class="slot-size-menu" id="size-menu-${index}" style="display: none;"></div>
        </div>

        <!-- Scrollable Content Viewport -->
        <div class="slot-content-container" id="slot-content-${index}">
          <div class="slot-placeholder" id="slot-placeholder-${index}">
            <span class="slot-placeholder-icon">💬</span>
            <p>输入 handle 并按回车或点击抓取</p>
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
      bgWebview: null,
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
      counter: el.querySelector(`#slot-counter-${i}`),
      btnCopyAll: el.querySelector(`#btn-copy-all-${i}`),
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
      slot.avatarImg.style.display = 'none';
      slot.avatarPlaceholder.style.display = 'flex';
    });

    // Pre-fill saved handle
    if (savedHandles[i]) {
      slot.handleInput.value = savedHandles[i];
    }

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

  // Copy all tweets
  slot.btnCopyAll.addEventListener('click', async () => {
    if (!slot.loadedTweets || slot.loadedTweets.length === 0) return;

    const handle = slot.handleInput.value.trim();
    const formatted = slot.loadedTweets.map((t, idx) => {
      const meta = [
        `#${idx + 1}`,
        t.time ? `(${t.time})` : '',
        t.isPinned ? '[置顶]' : '',
        t.isRetweet ? '[转推]' : ''
      ].filter(Boolean).join(' ');
      return `${meta}\n${t.text}`;
    }).join('\n\n--------------------\n\n');

    const text = `@${handle} 的最新 ${slot.loadedTweets.length} 条推文：\n\n${formatted}`;

    try {
      await navigator.clipboard.writeText(text);
      const orig = slot.btnCopyAll.innerText;
      slot.btnCopyAll.innerText = '已复制 ✓';
      slot.btnCopyAll.style.color = '#00ba7c';
      setTimeout(() => {
        slot.btnCopyAll.innerText = orig;
        slot.btnCopyAll.style.color = 'var(--text-secondary)';
      }, 1800);
    } catch (e) {
      console.error(e);
    }
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
  slot.tweetsList.innerHTML = '';
  slot.tweetsList.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.placeholder.style.display = 'flex';
  slot.authorName.innerText = '';
  slot.authorHandle.innerText = '';
  if (slot.authorHeader) slot.authorHeader.style.display = 'none';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
  if (slot.counter) slot.counter.style.display = 'none';
  if (slot.btnCopyAll) slot.btnCopyAll.style.display = 'none';
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
    if (r === 2 && c === 2) {
      slot.expandIcon.innerText = '⤡';
    } else if (r > 1 && c === 1) {
      slot.expandIcon.innerText = '↕';
    } else if (c > 1 && r === 1) {
      slot.expandIcon.innerText = '↔';
    } else {
      slot.expandIcon.innerText = '⤡';
    }
    slot.btnExpand.title = `当前尺寸: ${r}×${c} (点击切换或还原)`;
  } else {
    slot.card.classList.remove('is-priority');
    slot.btnExpand.classList.remove('expanded');
    slot.expandIcon.innerText = '⤢';
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

  // Header status counters & copy-all button
  if (slot.counter) {
    slot.counter.style.display = 'inline-block';
    slot.counter.innerText = `${tweets.length} 条`;
  }
  if (slot.btnCopyAll) {
    slot.btnCopyAll.style.display = 'inline-block';
    slot.btnCopyAll.innerText = '复制';
  }

  // Update header avatar
  if (avatarUrl) {
    updateSlotAvatar(slot, avatarUrl);
  }

  slot.tweetsList.innerHTML = '';

  tweets.forEach((tweet, index) => {
    const card = document.createElement('div');
    card.className = 'tweet-item-card';

    let tagHtml = '';
    if (tweet.isPinned) tagHtml += '<span class="tweet-tag">置顶</span>';
    if (tweet.isRetweet) tagHtml += '<span class="tweet-tag repost">转推</span>';

    card.innerHTML = `
      <div class="tweet-card-top">
        <div class="tweet-card-meta-left">
          <span class="tweet-index-pill">#${index + 1}</span>
          ${tagHtml}
        </div>
        <span class="tweet-card-time">${escapeHtml(tweet.time)}</span>
      </div>

      <div class="tweet-card-body">${escapeHtml(tweet.text)}</div>

      <div class="tweet-card-bottom">
        <div>
          ${tweet.url ? `<a class="tweet-link-btn" data-url="${escapeHtml(tweet.url)}">在浏览器中查看 ↗</a>` : ''}
        </div>
        <button class="btn-card-copy">复制</button>
      </div>
    `;

    if (tweet.url) {
      const linkBtn = card.querySelector('.tweet-link-btn');
      linkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        shell.openExternal(tweet.url);
      });
    }

    const copyBtn = card.querySelector('.btn-card-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tweet.text);
        const origText = copyBtn.innerText;
        copyBtn.innerText = '已复制 ✓';
        copyBtn.style.color = '#00ba7c';
        copyBtn.style.borderColor = '#00ba7c';
        setTimeout(() => {
          copyBtn.innerText = origText;
          copyBtn.style.color = '#71767b';
          copyBtn.style.borderColor = '#333639';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy tweet:', err);
      }
    });

    slot.tweetsList.appendChild(card);
  });

  const finalAvatar = avatarUrl || slot.avatarImg.src || '';
  saveSlotCache(slot.index, { handle, displayName, userHandle, tweets, avatarUrl: finalAvatar });
}

// ----------------------------------------------------
// Parallel Scraping with Jitter & Anti-Bot Protection
// ----------------------------------------------------
const EXTRACTION_SCRIPT = `
  (() => {
    try {
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

      // Extract user profile avatar URL
      let avatarUrl = '';
      const avatarSelectors = [
        'a[href$="/photo"] img',
        'div[data-testid="primaryColumn"] img[src*="profile_images"]',
        'img[src*="profile_images"]',
        'article [data-testid="Tweet-User-Avatar"] img'
      ];
      for (const sel of avatarSelectors) {
        const img = document.querySelector(sel);
        if (img && img.src && !img.src.includes('default_profile')) {
          avatarUrl = img.src;
          break;
        }
      }

      const items = [];
      for (const article of articles) {
        const statusLink = article.querySelector('a[href*="/status/"]');
        const tweetUrl = statusLink ? statusLink.getAttribute('href') : '';
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const timeEl = article.querySelector('time');
        const userNameEl = article.querySelector('[data-testid="User-Name"]');
        const isPinned = article.innerText.includes("Pinned") || article.innerText.includes("置顶");
        const isRetweet = article.innerText.includes("reposted") || article.innerText.includes("Retweeted") || article.innerText.includes("转推");

        let displayName = '';
        let userHandle = '';
        if (userNameEl) {
          const lines = userNameEl.innerText.split('\\n').filter(s => s.trim());
          if (lines.length > 0) displayName = lines[0];
          const foundHandle = lines.find(s => s.startsWith('@'));
          if (foundHandle) userHandle = foundHandle;
        }

        const text = textEl ? textEl.innerText.trim() : '(该推文为纯媒体/卡片内容，无文本)';
        const time = timeEl ? (timeEl.innerText || timeEl.getAttribute('datetime')) : '';

        items.push({
          url: tweetUrl ? 'https://x.com' + tweetUrl : '',
          text: text,
          time: time,
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

async function fetchSlot(slotIndex) {
  const slot = slots[slotIndex];
  if (slot.isFetching) return;

  const rawHandle = slot.handleInput.value.trim();
  const handle = rawHandle.replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?(twitter|x)\.com\//, '').replace(/\/$/, '');

  if (!handle) {
    showSlotError(slot, '请输入 Twitter handle');
    if (slot.authorHeader) slot.authorHeader.style.display = 'none';
    if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
    slot.handleInput.focus();
    return;
  }

  saveHandles();

  slot.isFetching = true;
  slot.btnFetch.disabled = true;
  slot.btnFetch.innerText = '抓取中';
  showSlotLoading(slot, `正在后台抓取 @${handle}...`);

  const targetUrl = `https://x.com/${handle}`;

  try {
    const bgWebview = getOrCreateSlotWebview(slotIndex);
    bgWebview.loadURL(targetUrl);

    const TARGET_COUNT = 5;
    const collectedTweets = [];
    const seenKeys = new Set();
    const maxAttempts = 35;
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;
    let latestAvatarUrl = '';

    while (attempts < maxAttempts) {
      attempts++;
      await sleep(randomBetween(450, 800));

      try {
        const result = await bgWebview.executeJavaScript(EXTRACTION_SCRIPT);

        if (result && result.error) {
          showSlotError(slot, result.error);
          return;
        }

        if (result && result.avatarUrl) {
          latestAvatarUrl = result.avatarUrl;
          updateSlotAvatar(slot, latestAvatarUrl);
        }

        if (result && result.success && Array.isArray(result.items)) {
          let newlyAdded = 0;
          for (const item of result.items) {
            if (collectedTweets.length >= TARGET_COUNT) break;

            const key = item.url || `${item.text.slice(0, 40)}_${item.time}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              collectedTweets.push(item);
              newlyAdded++;
            }
          }

          if (newlyAdded > 0) {
            consecutiveEmptyScrolls = 0;
            slot.loadingText.innerText = `已获取 (${collectedTweets.length}/${TARGET_COUNT})...`;
          } else {
            consecutiveEmptyScrolls++;
          }

          if (collectedTweets.length >= TARGET_COUNT) {
            break;
          }

          const scrollDistance = randomBetween(650, 1050);
          await bgWebview.executeJavaScript(`window.scrollBy({ top: ${scrollDistance}, behavior: 'smooth' });`);
          await sleep(randomBetween(300, 600));

          if (collectedTweets.length > 0 && consecutiveEmptyScrolls >= 6) {
            break;
          }
        }
      } catch (e) {
        // Ignore temporary navigation re-evaluation errors
      }
    }

    if (collectedTweets.length > 0) {
      renderSlotTweets(slot, collectedTweets, handle, latestAvatarUrl);
    } else {
      showSlotError(slot, '抓取超时：未检测到推文。请确认右上角已登录，或该用户近期是否发过推文。');
    }
  } catch (err) {
    showSlotError(slot, `发生异常: ${err.message}`);
  } finally {
    slot.isFetching = false;
    slot.btnFetch.disabled = false;
    slot.btnFetch.innerText = '抓取';
  }
}

// ----------------------------------------------------
// Parallel "Fetch All" Handler with Staggered Jitter
// ----------------------------------------------------
async function fetchAllSlotsParallel() {
  btnFetchAll.disabled = true;
  btnFetchAllText.innerText = '并行抓取中...';

  const totalSlots = currentRows * currentCols;
  const promises = [];

  for (let i = 0; i < totalSlots; i++) {
    const slot = slots[i];
    const handle = slot.handleInput.value.trim();
    if (handle) {
      const staggerDelay = i * randomBetween(200, 450);
      promises.push((async () => {
        if (staggerDelay > 0) await sleep(staggerDelay);
        return fetchSlot(i);
      })());
    }
  }

  await Promise.allSettled(promises);

  btnFetchAll.disabled = false;
  btnFetchAllText.innerText = '全部并行抓取';
}

btnFetchAll.addEventListener('click', fetchAllSlotsParallel);

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

  // Reset layout button
  btnResetLayout.addEventListener('click', () => {
    const val = layoutSelect.value;
    const { rows, cols } = parsePreset(val);
    applyGridLayout(rows, cols, true);
  });

  // Responsive dynamic cellHeight on window resize
  window.addEventListener('resize', () => {
    if (grid) {
      grid.cellHeight(calculateCellHeight(currentRows));
    }
  });
});
