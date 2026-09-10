const { shell } = require('electron');
const { MAX_SLOTS } = require('./constants');
const { escapeHtml, showToast, formatFetchTime } = require('./utils');
const {
  processAndSortTweets,
  getTweetDateKey,
  getTweetDateLabel,
  formatTelegramTime,
  shouldShowTweetPopup,
  isTweetWithQuote
} = require('./tweet');
const { openTweetPopup } = require('./popup');
const {
  getSavedHandles,
  saveHandles,
  getSlotCache,
  saveSlotCache,
  saveAllSlotCache
} = require('./storage');
const { getOrCreateSlotWebview } = require('./webview');

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

function updateSlotAvatar(slot, avatarUrl) {
  if (!slot) return;
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

function renderSlotTweets(slot, tweets, handle, avatarUrl = null, slots = []) {
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
        saveSlotCache(slot.index, { handle, displayName, userHandle, tweets, avatarUrl: finalAvatar }, slots);
      }
    });

    let tagHtml = '';
    if (tweet.isPinned) tagHtml += '<span class="tweet-tag">置顶</span>';
    if (tweet.isRetweet) tagHtml += '<span class="tweet-tag repost">转推</span>';
    if (isTweetWithQuote(tweet)) tagHtml += '<span class="tweet-tag quote">引用</span>';

    // Store avatar reference on tweet object if available
    if (!tweet.avatarUrl && finalAvatar) {
      tweet.avatarUrl = finalAvatar;
    }

    // Clean whitespace and character truncation for long tweets (> 100 characters)
    const rawText = (tweet.text || '').trim();
    const chars = Array.from(rawText);
    const isLong = chars.length > 100;
    const previewText = isLong ? chars.slice(0, 100).join('') : rawText;
    const timeDisplay = formatTelegramTime(tweet);

    let textHtml = '';
    if (isLong) {
      textHtml = `<span class="im-text-content"><span class="im-text-preview">${escapeHtml(previewText)}<span class="im-text-ellipsis">...</span></span></span>`;
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
          e.stopPropagation();
          shell.openExternal(tweet.url);
        });
      }
    }

    // Click on bubble to open centered tweet embed popup (click-to-open, no hover trigger)
    const hasPopup = shouldShowTweetPopup(tweet);
    if (hasPopup) {
      bubble.classList.add('has-popup');
      bubble.addEventListener('click', (e) => {
        if (e.target.closest('.im-btn-link')) return;
        openTweetPopup(tweet);
      });
    }

    slot.tweetsList.appendChild(bubble);
  });

  // Auto-scroll to bottom to show the latest tweets (Telegram style)
  requestAnimationFrame(() => {
    if (slot.contentContainer) {
      slot.contentContainer.scrollTop = slot.contentContainer.scrollHeight;
    }
  });

  saveSlotCache(slot.index, { handle, displayName, userHandle, tweets, avatarUrl: finalAvatar }, slots);
}

function clearSlot(slot, { slots } = {}) {
  slot.handleInput.value = '';
  if (slot.btnClear) slot.btnClear.style.display = 'none';
  updateSlotAvatar(slot, null);
  if (slots) saveHandles(slots);
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

function closeAllSizeMenus(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(s => {
    if (s.sizeMenu) s.sizeMenu.style.display = 'none';
  });
}

function toggleSlotSizeMenu(slot, { slots, getGridDimensions, onResize }) {
  const isOpen = slot.sizeMenu.style.display === 'flex';
  closeAllSizeMenus(slots);
  if (isOpen) return;

  const { rows: currentRows, cols: currentCols } = getGridDimensions ? getGridDimensions() : { rows: 2, cols: 2 };
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

  slot.sizeMenu.querySelectorAll('.size-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllSizeMenus(slots);
      const action = item.getAttribute('data-action');
      if (action === 'clear') {
        clearSlot(slot, { slots });
        return;
      }
      const targetR = parseInt(item.getAttribute('data-r'), 10);
      const targetC = parseInt(item.getAttribute('data-c'), 10);
      // 行在前 (targetR = h), 列在后 (targetC = w)
      if (onResize) {
        onResize(slot, targetC, targetR);
      }
    });
  });
}

function bindSlotEvents(slot, { slots, onFetch, onResize, getGridDimensions }) {
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
    saveHandles(slots);
    updateClearVisibility();
  });
  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && onFetch) onFetch(slot.index);
  });
  updateClearVisibility();

  // Clear handle button
  slot.btnClear.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSlot(slot, { slots });
  });

  // Fetch button
  slot.btnFetch.addEventListener('click', () => {
    if (onFetch) onFetch(slot.index);
  });

  // Expand / Size Menu trigger
  slot.btnExpand.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSlotSizeMenu(slot, { slots, getGridDimensions, onResize });
  });
}

function initSlotsRegistry({ slotsCount = MAX_SLOTS, bgWebviewsContainer, onFetch, onResize, getGridDimensions }) {
  const savedHandles = getSavedHandles();
  const slots = [];

  for (let i = 0; i < slotsCount; i++) {
    const el = createSlotWidget(i);
    const slot = {
      index: i,
      element: el,
      card: el.querySelector(`#slot-card-${i}`),
      bgWebview: getOrCreateSlotWebview(i, bgWebviewsContainer, slots),
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

    slots.push(slot);
    bindSlotEvents(slot, { slots, onFetch, onResize, getGridDimensions });
  }

  return slots;
}

function loadSlotCache(slots) {
  try {
    const cache = getSlotCache();
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
          tweets.forEach(t => {
          });
          slot.monitoredHandle = handle;
          const sorted = processAndSortTweets(tweets);
          renderSlotTweets(slot, sorted, handle, avatarUrl, slots);
        }
      }
    });
    if (hasCacheFix) {
      saveAllSlotCache(cache);
    }
  } catch (e) {}
}

function markAllTweetsAsRead(slots) {
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
        }, slots);
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

module.exports = {
  createSlotWidget,
  updateSlotAvatar,
  updateSlotFetchTimeUI,
  showSlotLoading,
  showSlotError,
  renderSlotTweets,
  clearSlot,
  slotHasContent,
  updateSlotSizeUI,
  closeAllSizeMenus,
  toggleSlotSizeMenu,
  bindSlotEvents,
  initSlotsRegistry,
  loadSlotCache,
  markAllTweetsAsRead
};
