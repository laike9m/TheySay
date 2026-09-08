const { ipcRenderer, shell } = require('electron');

const SLOTS_COUNT = 4;
const DEFAULT_HANDLES = ['elonmusk', 'OpenAI', 'sama', 'karpathy'];
const STORAGE_HANDLES_KEY = 'theysay_slot_handles';
const STORAGE_CACHE_KEY = 'theysay_slot_cache';

// Global UI Elements
const btnLoginStatus = document.getElementById('btn-login-status');
const loginStatusText = document.getElementById('login-status-text');
const btnFetchAll = document.getElementById('btn-fetch-all');
const btnFetchAllText = document.getElementById('btn-fetch-all-text');

// State per slot
const slots = [];

// Initialize Slot References
for (let i = 0; i < SLOTS_COUNT; i++) {
  slots.push({
    index: i,
    bgWebview: document.getElementById(`x-bg-webview-${i}`),
    handleInput: document.getElementById(`handle-input-${i}`),
    btnFetch: document.getElementById(`btn-fetch-${i}`),
    statusBar: document.getElementById(`slot-status-bar-${i}`),
    authorName: document.getElementById(`author-name-${i}`),
    authorHandle: document.getElementById(`author-handle-${i}`),
    counter: document.getElementById(`slot-counter-${i}`),
    btnCopyAll: document.getElementById(`btn-copy-all-${i}`),
    contentContainer: document.getElementById(`slot-content-${i}`),
    placeholder: document.getElementById(`slot-placeholder-${i}`),
    loading: document.getElementById(`slot-loading-${i}`),
    loadingText: document.getElementById(`slot-loading-text-${i}`),
    error: document.getElementById(`slot-error-${i}`),
    tweetsList: document.getElementById(`slot-tweets-list-${i}`),
    isFetching: false,
    loadedTweets: []
  });
}

// ----------------------------------------------------
// LocalStorage Persistence for Handles & Cached Tweets
// ----------------------------------------------------
function getSavedHandles() {
  try {
    const raw = localStorage.getItem(STORAGE_HANDLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === SLOTS_COUNT) {
        return parsed;
      }
    }
  } catch (e) {}
  return DEFAULT_HANDLES;
}

function saveHandles() {
  const currentHandles = slots.map(s => s.handleInput.value.trim());
  localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(currentHandles));
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
      for (let i = 0; i < SLOTS_COUNT; i++) {
        if (cache[i] && Array.isArray(cache[i].tweets) && cache[i].tweets.length > 0) {
          renderSlotTweets(slots[i], cache[i].tweets, cache[i].handle);
        }
      }
    }
  } catch (e) {}
}

// ----------------------------------------------------
// Login Status Checking & Popup Window Handling
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
// UI State Helpers per Slot
// ----------------------------------------------------
function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

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
  slot.counter.innerText = `${tweets.length} 条推文`;
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

  // Save to cache
  saveSlotCache(slot.index, { handle, tweets });
}

// ----------------------------------------------------
// Parallel Scraping Execution
// ----------------------------------------------------
const EXTRACTION_SCRIPT = `
  (() => {
    try {
      const bodyText = document.body ? document.body.innerText : '';
      
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
    const maxAttempts = 35; // ~18s
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(r => setTimeout(r, 500));

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

          await slot.bgWebview.executeJavaScript('window.scrollBy(0, 900);');

          if (collectedTweets.length > 0 && consecutiveEmptyScrolls >= 6) {
            break;
          }
        }
      } catch (e) {
        // Ignore navigation re-evaluation errors
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
// Parallel "Fetch All" Handler
// ----------------------------------------------------
async function fetchAllSlotsParallel() {
  btnFetchAll.disabled = true;
  btnFetchAllText.innerText = '4 栏并行抓取中...';

  // Trigger all 4 slots concurrently
  const promises = [];
  for (let i = 0; i < SLOTS_COUNT; i++) {
    const handle = slots[i].handleInput.value.trim();
    if (handle) {
      promises.push(fetchSlot(i));
    }
  }

  await Promise.allSettled(promises);

  btnFetchAll.disabled = false;
  btnFetchAllText.innerText = '全部并行抓取';
}

btnFetchAll.addEventListener('click', fetchAllSlotsParallel);

// ----------------------------------------------------
// Event Listeners Initialization
// ----------------------------------------------------
slots.forEach((slot, i) => {
  // Input enter key triggers fetch
  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      fetchSlot(i);
    }
  });

  // Save handles whenever user edits
  slot.handleInput.addEventListener('input', () => {
    saveHandles();
  });

  // Slot fetch button
  slot.btnFetch.addEventListener('click', () => {
    fetchSlot(i);
  });

  // Copy all tweets for this slot
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
      slot.btnCopyAll.innerText = '已复制全部 ✓';
      slot.btnCopyAll.style.color = '#00ba7c';
      slot.btnCopyAll.style.borderColor = '#00ba7c';
      setTimeout(() => {
        slot.btnCopyAll.innerText = orig;
        slot.btnCopyAll.style.color = '#71767b';
        slot.btnCopyAll.style.borderColor = '#333639';
      }, 1800);
    } catch (e) {
      console.error(e);
    }
  });
});

// ----------------------------------------------------
// Page Startup & State Restoration
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  checkLoginStatus();

  // Restore saved handles from localStorage
  const savedHandles = getSavedHandles();
  slots.forEach((slot, i) => {
    slot.handleInput.value = savedHandles[i] || '';
  });

  // Restore previously cached tweets if available
  loadSlotCache();
});
