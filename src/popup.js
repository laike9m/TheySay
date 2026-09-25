const { shell, ipcRenderer } = require('electron');
const { getTweetId, isMemberOnlyTweet } = require('./tweet');
const { escapeHtml } = require('./utils');

// Maximum number of simultaneously pre-rendered Twitter embeds kept alive.
// Each embed is a real iframe, so this is a memory/latency trade-off.
const MAX_PRERENDERED = 10;
// How many embeds may be rendering at the same time.
const MAX_CONCURRENT_RENDERS = 2;
// Give up on an embed after this long and show the fallback card instead.
const RENDER_TIMEOUT_MS = 15000;

// tweetId -> { el, status, promise, job, tweet }
//   status: 'idle' | 'pending' | 'ready' | 'failed'
const embedSlots = new Map();

let activeTweetId = null;
let currentTweet = null;
let renderQueue = [];
let activeRenders = 0;

function getOverlay() {
  return document.getElementById('tweet-popup-overlay');
}

function getEmbedContainer() {
  return document.getElementById('tweet-popup-embed-container');
}

function getLoadingEl() {
  return document.getElementById('tweet-popup-loading');
}

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function isTweetPopupOpen() {
  const overlay = getOverlay();
  return !!(overlay && !overlay.classList.contains('is-closed'));
}

/* ----------------------------------------------------------------
   Render queue
   ---------------------------------------------------------------- */

function pumpRenderQueue() {
  while (activeRenders < MAX_CONCURRENT_RENDERS && renderQueue.length > 0) {
    const job = renderQueue.shift();
    job();
  }
}

// Move a queued job to the front so a tweet the user is actually waiting on
// jumps ahead of background prefetch work.
function prioritizeSlot(entry) {
  if (!entry || !entry.job) return;
  const idx = renderQueue.indexOf(entry.job);
  if (idx > 0) {
    renderQueue.splice(idx, 1);
    renderQueue.unshift(entry.job);
  }
}

/* ----------------------------------------------------------------
   Slot management
   ---------------------------------------------------------------- */

function evictStaleSlots() {
  if (embedSlots.size <= MAX_PRERENDERED) return;
  // Map preserves insertion order, so the oldest entries come first.
  for (const [id, entry] of embedSlots) {
    if (embedSlots.size <= MAX_PRERENDERED) break;
    // Never evict what's on screen or still being built.
    if (id === activeTweetId || entry.status === 'pending') continue;
    if (entry.el && entry.el.parentNode) {
      entry.el.parentNode.removeChild(entry.el);
    }
    embedSlots.delete(id);
  }
}

function ensureSlot(tweetId, tweet) {
  let entry = embedSlots.get(tweetId);
  if (entry) {
    if (tweet) entry.tweet = tweet;
    return entry;
  }

  const container = getEmbedContainer();
  if (!container) return null;

  // Each tweet keeps its own persistent host element. It is created once and
  // never re-parented, because moving an iframe in the DOM forces it to reload.
  const el = document.createElement('div');
  el.className = 'tweet-embed-slot';
  el.setAttribute('data-tweet-id', tweetId);
  container.appendChild(el);

  entry = { el, status: 'idle', promise: null, job: null, tweet: tweet || null };
  embedSlots.set(tweetId, entry);
  evictStaleSlots();
  return entry;
}

function renderSlot(entry, tweetId) {
  if (entry.promise) return entry.promise;

  entry.status = 'pending';
  entry.promise = new Promise((resolve) => {
    const start = () => {
      activeRenders++;
      let settled = false;

      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeRenders--;
        entry.job = null;
        entry.status = ok ? 'ready' : 'failed';
        if (!ok) renderFallbackInto(entry);
        pumpRenderQueue();
        resolve(entry.status);
      };

      const timer = setTimeout(() => done(false), RENDER_TIMEOUT_MS);

      const twttr = window.twttr;
      if (!twttr || !twttr.widgets || !twttr.widgets.createTweet) {
        done(false);
        return;
      }

      // The slot must have a real, non-zero layout width here: Twitter's widget
      // factory measures the host element to size its iframe, and a zero-width
      // host makes it silently bail out.
      twttr.widgets.createTweet(tweetId, entry.el, {
        theme: getCurrentTheme(),
        align: 'center',
        dnt: true
      })
        .then((el) => done(!!el))
        .catch(() => done(false));
    };

    entry.job = start;
    renderQueue.push(start);
    pumpRenderQueue();
  });

  return entry.promise;
}

function deactivateSlot(tweetId) {
  const entry = embedSlots.get(tweetId);
  if (entry && entry.el) entry.el.classList.remove('is-active');
}

/* ----------------------------------------------------------------
   Fallback card (offline / deleted / protected tweets)
   ---------------------------------------------------------------- */

function renderFallbackInto(entry) {
  const tweet = entry.tweet;
  if (!entry.el || !tweet) return;

  const rawText = (tweet.text || '').trim();
  const timeDisplay = tweet.time || (tweet.datetime ? new Date(tweet.datetime).toLocaleString() : '');
  const displayName = tweet.displayName || tweet.userHandle || '';
  const userHandle = tweet.userHandle || '';
  const avatarUrl = tweet.avatarUrl || '';

  const fallbackDiv = document.createElement('div');
  fallbackDiv.className = 'tweet-popup-fallback';

  let memberInfoHtml = '';
  if (isMemberOnlyTweet(tweet)) {
    memberInfoHtml = `
      <div class="tweet-popup-fallback-member">
        <span class="tweet-tag member">仅会员可见</span>
        <span class="tweet-member-notice">此推文为创作者会员 / 订阅专享内容</span>
      </div>
    `;
  }

  let quoteInfoHtml = '';
  if (tweet.hasQuote || tweet.quoteUrl) {
    quoteInfoHtml = `
      <div class="tweet-popup-fallback-quote">
        <span class="tweet-tag quote">引用推文</span>
        ${tweet.quoteUrl ? `<a href="#" class="tweet-fallback-quote-link" data-url="${escapeHtml(tweet.quoteUrl)}">查看被引用推文 ↗</a>` : ''}
      </div>
    `;
  }

  fallbackDiv.innerHTML = `
    <div class="tweet-popup-fallback-header">
      ${avatarUrl ? `<img class="tweet-popup-fallback-avatar" src="${escapeHtml(avatarUrl)}" alt="">` : '<div class="tweet-popup-fallback-avatar-placeholder">👤</div>'}
      <div class="tweet-popup-fallback-names">
        <span class="tweet-popup-fallback-name">${escapeHtml(displayName)}</span>
        <span class="tweet-popup-fallback-handle">${escapeHtml(userHandle)}</span>
      </div>
    </div>
    ${memberInfoHtml}
    <div class="tweet-popup-fallback-text">${escapeHtml(rawText)}</div>
    ${quoteInfoHtml}
    <div class="tweet-popup-fallback-footer">
      <span class="tweet-popup-fallback-time">${escapeHtml(timeDisplay)}</span>
      ${tweet.url ? `<button class="tweet-popup-fallback-btn" data-url="${escapeHtml(tweet.url)}">在 Twitter / X 上打开 ↗</button>` : ''}
    </div>
  `;

  fallbackDiv.querySelectorAll('[data-url]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      if (url) shell.openExternal(url);
    });
  });

  entry.el.innerHTML = '';
  entry.el.appendChild(fallbackDiv);
}

/* ----------------------------------------------------------------
   Public API
   ---------------------------------------------------------------- */

// Warm a tweet's embed in the background so a later click is instant.
function prefetchTweet(tweet, { priority = false } = {}) {
  // Discord messages and member-only tweets are rendered locally from data we already hold;
  // there is no third-party widget to warm up.
  if (!tweet || tweet.source === 'discord' || isMemberOnlyTweet(tweet)) return;

  const tweetId = getTweetId(tweet);
  if (!tweetId) return;

  const existing = embedSlots.get(tweetId);
  if (existing) {
    if (tweet) existing.tweet = tweet;
    if (priority) prioritizeSlot(existing);
    if (!existing.promise) renderSlot(existing, tweetId);
    return;
  }

  // Don't let background prefetching blow past the memory budget; an explicit
  // (hover/click) request is allowed to evict something older.
  if (!priority && embedSlots.size >= MAX_PRERENDERED) return;

  const entry = ensureSlot(tweetId, tweet);
  if (!entry) return;
  renderSlot(entry, tweetId);
  if (priority) prioritizeSlot(entry);
}

/* ----------------------------------------------------------------
   Discord message card
   ---------------------------------------------------------------- */

// Discord messages are already fully scraped, so there is nothing to pre-render
// or cache: one reusable host element is enough.
let discordSlotEl = null;

function getDiscordSlotEl() {
  if (discordSlotEl) return discordSlotEl;
  const container = getEmbedContainer();
  if (!container) return null;

  discordSlotEl = document.createElement('div');
  discordSlotEl.className = 'tweet-embed-slot discord-embed-slot';
  container.appendChild(discordSlotEl);
  return discordSlotEl;
}

function renderDiscordCardInto(el, msg) {
  const rawText = (msg.text || '').trim();
  const timeDisplay = msg.datetime ? new Date(msg.datetime).toLocaleString() : (msg.time || '');

  let replyHtml = '';
  if (msg.replyText || msg.replyAuthor) {
    replyHtml = `
      <div class="discord-popup-reply">
        <span class="discord-popup-reply-author">↩ ${escapeHtml(msg.replyAuthor || '')}</span>
        <span class="discord-popup-reply-text">${escapeHtml(msg.replyText || '')}</span>
      </div>
    `;
  }

  let attachmentsHtml = '';
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    attachmentsHtml = `
      <div class="discord-popup-attachments">
        ${msg.attachments.map(a => `<span class="im-attachment-chip">${escapeHtml(a)}</span>`).join('')}
      </div>
    `;
  }

  el.innerHTML = `
    <div class="discord-popup-card">
      <div class="discord-popup-header">
        ${msg.avatarUrl
          ? `<img class="discord-popup-avatar" src="${escapeHtml(msg.avatarUrl)}" alt="">`
          : '<div class="discord-popup-avatar-placeholder">#</div>'}
        <div class="discord-popup-names">
          <span class="discord-popup-name">${escapeHtml(msg.displayName || '')}</span>
          ${msg.isBot ? '<span class="tweet-tag bot">BOT</span>' : ''}
        </div>
      </div>
      ${replyHtml}
      <div class="discord-popup-text">${escapeHtml(rawText)}</div>
      ${attachmentsHtml}
      <div class="discord-popup-footer">
        <span class="discord-popup-time">${escapeHtml(timeDisplay)}</span>
        ${msg.url ? '<button class="tweet-popup-fallback-btn" data-url="' + escapeHtml(msg.url) + '">在 Discord 中打开 ↗</button>' : ''}
      </div>
    </div>
  `;

  el.querySelectorAll('[data-url]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      if (url) shell.openExternal(url);
    });
  });
}

function openDiscordPopup(msg) {
  const el = getDiscordSlotEl();
  if (!el) return;

  if (activeTweetId) deactivateSlot(activeTweetId);
  activeTweetId = null;
  currentTweet = msg;

  renderDiscordCardInto(el, msg);
  el.classList.add('is-active');

  const loadingEl = getLoadingEl();
  if (loadingEl) loadingEl.style.display = 'none';
  openOverlay();
}

function openTweetPopup(tweet) {
  if (!tweet) return;
  if (tweet.source === 'discord') {
    openDiscordPopup(tweet);
    return;
  }

  const overlay = getOverlay();
  const loadingEl = getLoadingEl();
  if (!overlay) return;

  const tweetId = getTweetId(tweet);
  currentTweet = tweet;

  // Hide whatever was shown before.
  if (discordSlotEl) discordSlotEl.classList.remove('is-active');
  if (activeTweetId && activeTweetId !== tweetId) {
    deactivateSlot(activeTweetId);
  }

  if (!tweetId) {
    if (loadingEl) loadingEl.style.display = 'none';
    openOverlay();
    return;
  }

  const entry = ensureSlot(tweetId, tweet);
  if (!entry) return;

  activeTweetId = tweetId;
  entry.el.classList.add('is-active');
  openOverlay();

  // If this is a member-only tweet, Twitter's public embed iframe cannot render it.
  // Immediately render the rich fallback card with "仅会员可见" notice without waiting for widget timeout.
  if (isMemberOnlyTweet(tweet)) {
    if (loadingEl) loadingEl.style.display = 'none';
    renderFallbackInto(entry);
    return;
  }

  if (entry.status === 'ready' || entry.status === 'failed') {
    // Already pre-rendered: the card is on screen immediately, no swap, no spinner.
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  }

  // Not warmed up yet: show the spinner until the real card is ready, then
  // reveal the card directly. No intermediate placeholder is ever shown.
  if (loadingEl) loadingEl.style.display = 'flex';
  prioritizeSlot(entry);

  renderSlot(entry, tweetId).then(() => {
    if (activeTweetId !== tweetId) return;
    if (loadingEl) loadingEl.style.display = 'none';
  });
}

function openOverlay() {
  const overlay = getOverlay();
  if (!overlay) return;
  overlay.classList.remove('is-closed');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.focus();
}

function closeTweetPopup() {
  const overlay = getOverlay();
  const loadingEl = getLoadingEl();

  if (overlay) {
    overlay.classList.add('is-closed');
    overlay.setAttribute('aria-hidden', 'true');
  }

  // Only hide the active slot; the rendered iframe stays in the DOM so that
  // reopening the same tweet is instant.
  if (activeTweetId) deactivateSlot(activeTweetId);
  if (discordSlotEl) discordSlotEl.classList.remove('is-active');
  activeTweetId = null;

  if (loadingEl) loadingEl.style.display = 'none';
  currentTweet = null;
}

// Twitter bakes the colour scheme into the embed at creation time, so every
// pre-rendered card has to be thrown away when the theme flips.
function clearTweetWidgetCache() {
  const wasOpen = isTweetPopupOpen();
  const tweet = currentTweet;

  renderQueue = [];
  for (const entry of embedSlots.values()) {
    if (entry.el && entry.el.parentNode) {
      entry.el.parentNode.removeChild(entry.el);
    }
  }
  embedSlots.clear();
  activeTweetId = null;

  if (wasOpen && tweet) {
    openTweetPopup(tweet);
  }
}

function initTweetPopup() {
  const overlay = getOverlay();

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // Clicking the card itself shouldn't dismiss the popup.
      if (e.target.closest('.tweet-embed-slot')) return;
      if (e.target.closest('.tweet-popup-loading')) return;
      closeTweetPopup();
    });
  }

  const handleEscKey = (e) => {
    if (e.key === 'Escape' && isTweetPopupOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closeTweetPopup();
    }
  };

  window.addEventListener('keydown', handleEscKey, true);
  document.addEventListener('keydown', handleEscKey, true);

  // Escape needs to work even while focus sits inside the Twitter iframe,
  // which the renderer can't observe directly.
  if (ipcRenderer) {
    ipcRenderer.on('global-escape', () => {
      if (isTweetPopupOpen()) closeTweetPopup();
    });
  }
}

module.exports = {
  initTweetPopup,
  openTweetPopup,
  closeTweetPopup,
  isTweetPopupOpen,
  prefetchTweet,
  clearTweetWidgetCache
};
