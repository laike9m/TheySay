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

// UI Elements - Global
const btnLoginStatus = document.getElementById('btn-login-status');
const loginStatusText = document.getElementById('login-status-text');
const btnFetchAll = document.getElementById('btn-fetch-all');
const btnFetchAllText = document.getElementById('btn-fetch-all-text');
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

function loadSlotCache() {
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    if (raw) {
      const cache = JSON.parse(raw);
      slots.forEach(slot => {
        if (cache[slot.index] && Array.isArray(cache[slot.index].tweets)) {
          renderSlotTweets(slot, cache[slot.index].tweets, cache[slot.index].handle);
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
// Background Webviews Pool Initialization
// ----------------------------------------------------
function initBackgroundWebviews() {
  bgWebviewsContainer.innerHTML = '';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const wv = document.createElement('webview');
    wv.id = `x-bg-webview-${i}`;
    wv.src = 'about:blank';
    wv.setAttribute('partition', 'persist:x_session');
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');
    bgWebviewsContainer.appendChild(wv);
  }
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
        <!-- Header & Drag Handle -->
        <div class="slot-header slot-drag-handle">
          <span class="slot-drag-indicator" title="按住拖拽卡片">⠿</span>
          <span class="slot-index-badge">#${index + 1}</span>
          <div class="slot-input-wrapper">
            <span class="slot-input-prefix">@</span>
            <input type="text" class="slot-handle-input" id="handle-input-${index}" placeholder="用户名" autocomplete="off" spellcheck="false">
          </div>
          <button class="slot-btn-fetch" id="btn-fetch-${index}">抓取</button>
          <button class="slot-btn-expand" id="btn-expand-${index}" title="放大 / 还原重点关注空间 (Toggle 2×2 / 1×1)">⤢</button>
        </div>

        <!-- Status & Author Bar -->
        <div class="slot-status-bar" id="slot-status-bar-${index}" style="display: none;">
          <div class="slot-author-info">
            <span class="slot-author-name" id="author-name-${index}"></span>
            <span class="slot-author-handle" id="author-handle-${index}"></span>
          </div>
          <div class="slot-status-actions">
            <span class="slot-counter" id="slot-counter-${index}">0 条</span>
            <button class="slot-btn-copy-all" id="btn-copy-all-${index}" title="复制本栏全部推文">复制</button>
          </div>
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
  const availableHeight = window.innerHeight - 74; // top nav + padding
  const margin = 10;
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
      bgWebview: document.getElementById(`x-bg-webview-${i}`),
      handleInput: el.querySelector(`#handle-input-${i}`),
      btnFetch: el.querySelector(`#btn-fetch-${i}`),
      btnExpand: el.querySelector(`#btn-expand-${i}`),
      statusBar: el.querySelector(`#slot-status-bar-${i}`),
      authorName: el.querySelector(`#author-name-${i}`),
      authorHandle: el.querySelector(`#author-handle-${i}`),
      counter: el.querySelector(`#slot-counter-${i}`),
      btnCopyAll: el.querySelector(`#btn-copy-all-${i}`),
      contentContainer: el.querySelector(`#slot-content-${i}`),
      placeholder: el.querySelector(`#slot-placeholder-${i}`),
      loading: el.querySelector(`#slot-loading-${i}`),
      loadingText: el.querySelector(`#slot-loading-text-${i}`),
      error: el.querySelector(`#slot-error-${i}`),
      tweetsList: el.querySelector(`#slot-tweets-list-${i}`),
      isFetching: false,
      isExpanded: false,
      loadedTweets: []
    };

    // Pre-fill saved handle
    if (savedHandles[i]) {
      slot.handleInput.value = savedHandles[i];
    }

    bindSlotEvents(slot);
    slots.push(slot);
  }
}

function bindSlotEvents(slot) {
  // Input changes
  slot.handleInput.addEventListener('input', saveHandles);
  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchSlot(slot.index);
  });

  // Fetch button
  slot.btnFetch.addEventListener('click', () => fetchSlot(slot.index));

  // Expand / Priority Focus Toggle
  slot.btnExpand.addEventListener('click', () => {
    toggleSlotExpand(slot);
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
        slot.btnCopyAll.style.color = '#71767b';
      }, 1800);
    } catch (e) {
      console.error(e);
    }
  });
}

function toggleSlotExpand(slot) {
  if (!grid) return;
  const node = slot.element.gridstackNode;
  if (!node) return;

  const isCurrentlyExpanded = (node.w > 1 || node.h > 1);

  if (isCurrentlyExpanded) {
    grid.update(slot.element, { w: 1, h: 1 });
    slot.card.classList.remove('is-priority');
    slot.btnExpand.classList.remove('expanded');
    slot.btnExpand.title = '放大重点关注空间 (2×2)';
  } else {
    const targetW = Math.min(2, currentCols);
    const targetH = Math.min(2, currentRows);
    grid.update(slot.element, { w: targetW, h: targetH });
    slot.card.classList.add('is-priority');
    slot.btnExpand.classList.add('expanded');
    slot.btnExpand.title = '还原正常卡片大小 (1×1)';
  }

  saveGridLayout();
}

function applyGridLayout(rows, cols, resetPositions = false) {
  currentRows = rows;
  currentCols = cols;

  grid.column(cols);
  grid.cellHeight(calculateCellHeight(rows));

  const totalSlots = rows * cols;

  // Detach or add widgets based on target total slots
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = slots[i];
    const isAttached = !!slot.element.parentElement;

    if (i < totalSlots) {
      if (!isAttached) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        grid.makeWidget(slot.element);
        grid.update(slot.element, { x: col, y: row, w: 1, h: 1 });
      } else if (resetPositions) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        grid.update(slot.element, { x: col, y: row, w: 1, h: 1 });
        slot.card.classList.remove('is-priority');
        slot.btnExpand.classList.remove('expanded');
      }
    } else {
      if (isAttached) {
        grid.removeWidget(slot.element, false, false);
      }
    }
  }

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
  slot.statusBar.style.display = 'none';
}

function showSlotError(slot, errorMsg) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'block';
  slot.error.innerHTML = `⚠️ ${errorMsg}`;
  slot.tweetsList.style.display = 'none';
  slot.statusBar.style.display = 'none';
}

function renderSlotTweets(slot, tweets, handle) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.tweetsList.style.display = 'flex';
  slot.statusBar.style.display = 'flex';

  slot.loadedTweets = tweets;

  const firstTweet = tweets[0] || {};
  const name = firstTweet.displayName || handle;
  slot.authorName.innerText = name;
  slot.authorHandle.innerText = firstTweet.userHandle || `@${handle}`;
  slot.counter.innerText = `${tweets.length} 条`;
  slot.btnCopyAll.innerText = `复制全部 (${tweets.length})`;

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

  saveSlotCache(slot.index, { handle, tweets });
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

      return { success: true, items: items };
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
    slot.bgWebview.loadURL(targetUrl);

    const TARGET_COUNT = 5;
    const collectedTweets = [];
    const seenKeys = new Set();
    const maxAttempts = 35;
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;

    while (attempts < maxAttempts) {
      attempts++;
      await sleep(randomBetween(450, 800));

      try {
        const result = await slot.bgWebview.executeJavaScript(EXTRACTION_SCRIPT);

        if (result && result.error) {
          showSlotError(slot, result.error);
          return;
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
          await slot.bgWebview.executeJavaScript(`window.scrollBy({ top: ${scrollDistance}, behavior: 'smooth' });`);
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
      renderSlotTweets(slot, collectedTweets, handle);
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
  initBackgroundWebviews();
  initSlotsRegistry();
  checkLoginStatus();

  // Initialize GridStack
  const savedPreset = localStorage.getItem(STORAGE_PRESET_KEY) || '2x2';
  layoutSelect.value = savedPreset;
  const { rows, cols } = parsePreset(savedPreset);

  grid = GridStack.init({
    column: cols,
    cellHeight: calculateCellHeight(rows),
    margin: 10,
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

  // Save on layout changes (drag, resize)
  grid.on('change', () => {
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
