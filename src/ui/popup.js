const { shell, ipcRenderer } = require('electron');
const PQueue = require('p-queue').default;
const { LRUCache } = require('lru-cache');
const { getPostId, isMemberOnlyPost } = require('../core/post');
const { stripDiscordEditedText } = require('../core/utils');
const { formatTextWithTickers, registerUrlTitlesMap, fetchUrlTitle } = require('../core/ticker');
const { installRendererEmbedHooks } = require('./tweet_embed');
const {
  t,
  translateAttachmentLabel,
  isImageAttachmentLabel,
  normalizeMediaOnlyText
} = require('../core/i18n');
const {
  renderMantineTwitterFallbackCard,
  renderMantineDiscordPopupCard,
  renderMantineThreadsPopupCard
} = require('./dist/mantine-shell');

// Maximum number of simultaneously pre-rendered Twitter embeds kept alive.
// Each embed is a real iframe, so this is a memory/latency trade-off.
const MAX_PRERENDERED = 10;
// How many embeds may be rendering at the same time.
const MAX_CONCURRENT_RENDERS = 2;
// Give up on an embed after this long and show the fallback card instead.
const RENDER_TIMEOUT_MS = 15000;

// postId -> { el, status, promise, runTask, started, prioritized, disposed, post }
//   status: 'idle' | 'pending' | 'ready' | 'failed'
const embedSlots = new LRUCache({ max: MAX_PRERENDERED * 4 });
const renderQueue = new PQueue({ concurrency: MAX_CONCURRENT_RENDERS });

let activePostId = null;
let currentPost = null;

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
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function isPostPopupOpen() {
  const overlay = getOverlay();
  return !!(overlay && !overlay.classList.contains('is-closed'));
}

/* ----------------------------------------------------------------
   Render queue
   ---------------------------------------------------------------- */

// Promote a queued job to high priority so a post the user is actually waiting on
// jumps ahead of background prefetch work.
function prioritizeSlot(entry) {
  if (!entry || entry.started || entry.prioritized || !entry.runTask) return;
  entry.prioritized = true;
  renderQueue.add(entry.runTask, { priority: 1 });
}

/* ----------------------------------------------------------------
   Slot management
   ---------------------------------------------------------------- */

function evictStaleSlots() {
  if (embedSlots.size <= MAX_PRERENDERED) return;
  // Iterate least-recently-used keys first.
  for (const id of Array.from(embedSlots.rkeys())) {
    if (embedSlots.size <= MAX_PRERENDERED) break;
    const entry = embedSlots.peek(id);
    if (!entry) continue;
    // Never evict what's on screen or still being built.
    if (id === activePostId || entry.status === 'pending') continue;
    entry.disposed = true;
    if (entry.el && entry.el.parentNode) {
      entry.el.parentNode.removeChild(entry.el);
    }
    embedSlots.delete(id);
  }
}

function ensureSlot(postId, post) {
  let entry = embedSlots.get(postId);
  if (entry) {
    if (post) entry.post = post;
    return entry;
  }

  const container = getEmbedContainer();
  if (!container) return null;

  // Each post keeps its own persistent host element. It is created once and
  // never re-parented, because moving an iframe in the DOM forces it to reload.
  const el = document.createElement('div');
  el.className = 'tweet-embed-slot';
  el.setAttribute('data-tweet-id', postId);
  container.appendChild(el);

  entry = {
    el,
    status: 'idle',
    promise: null,
    runTask: null,
    started: false,
    prioritized: false,
    disposed: false,
    post: post || null
  };
  embedSlots.set(postId, entry);
  evictStaleSlots();
  return entry;
}

function renderSlot(entry, postId, { priority = false } = {}) {
  if (entry.promise) return entry.promise;

  entry.status = 'pending';
  entry.promise = new Promise((resolve) => {
    let taskPromise = null;
    entry.runTask = () => {
      if (entry.disposed) {
        resolve('failed');
        return Promise.resolve();
      }
      if (entry.started) return taskPromise || Promise.resolve();
      entry.started = true;

      taskPromise = new Promise((finishTask) => {
        let settled = false;
        const done = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          entry.runTask = null;
          entry.status = ok ? 'ready' : 'failed';
          if (!ok && !entry.disposed) renderFallbackInto(entry);
          resolve(entry.status);
          finishTask();
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
        twttr.widgets.createTweet(postId, entry.el, {
          theme: getCurrentTheme(),
          align: 'center',
          dnt: true
        })
          .then((el) => done(!!el))
          .catch(() => done(false));
      });

      return taskPromise;
    };

    if (priority) entry.prioritized = true;
    renderQueue.add(entry.runTask, { priority: priority ? 1 : 0 });
  });

  return entry.promise;
}

function deactivateSlot(postId) {
  const entry = embedSlots.get(postId);
  if (entry && entry.el) entry.el.classList.remove('is-active');
}

/* ----------------------------------------------------------------
   Fallback card (offline / deleted / protected posts)
   ---------------------------------------------------------------- */

function resolvePopupLinksInElement(containerEl, post) {
  if (!containerEl) return;
  const linkEls = containerEl.querySelectorAll('.popup-inline-link[data-raw-url]');
  linkEls.forEach((linkEl) => {
    const rawUrl = linkEl.getAttribute('data-raw-url') || linkEl.getAttribute('data-url') || '';
    if (!rawUrl) return;
    const currentText = (linkEl.textContent || '').trim();
    if (currentText !== rawUrl) return;
    fetchUrlTitle(rawUrl)
      .then((title) => {
        if (!title) return;
        if (post) {
          if (!post.linkTitles || typeof post.linkTitles !== 'object') {
            post.linkTitles = {};
          }
          post.linkTitles[rawUrl] = title;
        }
        if (linkEl.isConnected) {
          linkEl.textContent = title;
        }
      })
      .catch(() => {});
  });
}

function renderFallbackInto(entry) {
  const post = entry.post;
  if (!entry.el || !post) return;

  if (post.linkTitles) {
    registerUrlTitlesMap(post.linkTitles, { persist: false });
  }

  const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
  const rawText = normalizeMediaOnlyText((post.text || '').trim());
  const isMediaFallbackOnly = images.length > 0 && rawText === t('scraper.mediaOnlyFallback');
  const effectiveText = isMediaFallbackOnly ? '' : rawText;
  const timeDisplay = post.time || (post.datetime ? new Date(post.datetime).toLocaleString() : '');
  const displayName = post.displayName || post.userHandle || '';
  const userHandle = post.userHandle || '';
  const avatarUrl = post.avatarUrl || '';
  const effectiveTextHtml = effectiveText
    ? formatTextWithTickers(effectiveText, undefined, {
        linkifyUrls: true,
        linkTitles: post.linkTitles
      })
    : '';

  renderMantineTwitterFallbackCard(entry.el, {
    avatarUrl,
    displayName,
    userHandle,
    isMemberOnly: isMemberOnlyPost(post),
    effectiveTextHtml,
    images,
    hasQuote: Boolean(post.hasQuote || post.quoteUrl),
    quoteUrl: post.quoteUrl || '',
    timeDisplay,
    postUrl: post.url || '',
    labels: {
      memberOnlyTag: t('popup.memberOnlyTag'),
      memberOnlyNotice: t('popup.memberOnlyNotice'),
      imageAlt: t('slot.imageAlt'),
      viewOriginalImageTitle: t('popup.viewOriginalImageTitle'),
      quoteTag: t('popup.quoteTag'),
      viewQuotedPost: t('popup.viewQuotedPost'),
      openOnTwitter: t('popup.openOnTwitter')
    },
    onOpenExternal: (url) => {
      if (url) shell.openExternal(url);
    }
  });

  resolvePopupLinksInElement(entry.el, post);
}

/* ----------------------------------------------------------------
   Public API
   ---------------------------------------------------------------- */

// Warm a post's embed in the background so a later click is instant.
function prefetchPost(post, { priority = false } = {}) {
  // Discord messages, Threads posts, merged posts, and member-only posts are rendered locally from data we already hold;
  // there is no third-party widget to warm up.
  if (!post || post.source === 'discord' || post.source === 'threads' || post.isMerged || isMemberOnlyPost(post)) return;

  const postId = getPostId(post);
  if (!postId) return;

  const existing = embedSlots.get(postId);
  if (existing) {
    if (post) existing.post = post;
    if (priority) prioritizeSlot(existing);
    if (!existing.promise) renderSlot(existing, postId, { priority });
    return;
  }

  // Don't let background prefetching blow past the memory budget; an explicit
  // (hover/click) request is allowed to evict something older.
  if (!priority && embedSlots.size >= MAX_PRERENDERED) return;

  const entry = ensureSlot(postId, post);
  if (!entry) return;
  renderSlot(entry, postId, { priority });
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
  if (msg && msg.linkTitles) {
    registerUrlTitlesMap(msg.linkTitles, { persist: false });
  }
  const rawText = stripDiscordEditedText(msg.text || '');
  const cleanReplyText = stripDiscordEditedText(msg.replyText || '');
  const timeDisplay = msg.datetime ? new Date(msg.datetime).toLocaleString() : (msg.time || '');

  const hasReply = Boolean(cleanReplyText || msg.replyAuthor);
  const replyTextHtml = hasReply
    ? formatTextWithTickers(cleanReplyText, undefined, {
        linkifyUrls: true,
        linkTitles: msg.linkTitles
      })
    : '';
  const textHtml = rawText
    ? formatTextWithTickers(rawText, undefined, {
        linkifyUrls: true,
        linkTitles: msg.linkTitles
      })
    : '';

  const images = Array.isArray(msg.images) ? msg.images.filter(Boolean) : [];
  const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const visibleAttachments = images.length > 0
    ? rawAttachments.filter(a => !isImageAttachmentLabel(a))
    : rawAttachments;
  const attachmentLabels = visibleAttachments.map(a => translateAttachmentLabel(a));

  renderMantineDiscordPopupCard(el, {
    avatarUrl: msg.avatarUrl || '',
    displayName: msg.displayName || '',
    isBot: Boolean(msg.isBot),
    hasReply,
    replyAuthor: msg.replyAuthor || '',
    replyTextHtml,
    textHtml,
    images,
    attachmentLabels,
    timeDisplay,
    msgUrl: msg.url || '',
    labels: {
      imageAlt: t('slot.imageAlt'),
      viewOriginalImageTitle: t('popup.viewOriginalImageTitle'),
      openInDiscord: t('popup.openInDiscord')
    },
    onOpenExternal: (url) => {
      if (url) shell.openExternal(url);
    }
  });

  resolvePopupLinksInElement(el, msg);
}

function openDiscordPopup(msg) {
  const el = getDiscordSlotEl();
  if (!el) return;

  if (activePostId) deactivateSlot(activePostId);
  if (threadsSlotEl) threadsSlotEl.classList.remove('is-active');
  activePostId = null;
  currentPost = msg;

  renderDiscordCardInto(el, msg);
  el.classList.add('is-active');

  const loadingEl = getLoadingEl();
  if (loadingEl) loadingEl.style.display = 'none';
  openOverlay();
}

/* ----------------------------------------------------------------
   Threads post card
   ---------------------------------------------------------------- */

let threadsSlotEl = null;

function getThreadsSlotEl() {
  if (threadsSlotEl) return threadsSlotEl;
  const container = getEmbedContainer();
  if (!container) return null;

  threadsSlotEl = document.createElement('div');
  threadsSlotEl.className = 'tweet-embed-slot threads-embed-slot';
  container.appendChild(threadsSlotEl);
  return threadsSlotEl;
}

function renderThreadsCardInto(el, post) {
  if (post && post.linkTitles) {
    registerUrlTitlesMap(post.linkTitles, { persist: false });
  }
  const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
  const rawText = normalizeMediaOnlyText((post.text || '').trim());
  const isMediaFallbackOnly = images.length > 0 && rawText === t('scraper.mediaOnlyFallback');
  const effectiveText = isMediaFallbackOnly ? '' : rawText;
  const timeDisplay = post.datetime ? new Date(post.datetime).toLocaleString() : (post.time || '');
  const displayName = post.displayName || post.userHandle || '';
  const userHandle = post.userHandle || '';
  const showUserHandle = Boolean(
    userHandle && userHandle.toLowerCase() !== displayName.toLowerCase()
  );

  const hasQuote = Boolean(
    post.hasQuote || post.quoteUrl || post.quoteText || post.quoteAuthor
  );
  const quoteAuthor = post.quoteAuthor
    ? (post.quoteAuthor.startsWith('@') ? post.quoteAuthor : `@${post.quoteAuthor}`)
    : '';
  const qText = (post.quoteText || '').trim();
  const quoteTextHtml = qText
    ? formatTextWithTickers(qText, undefined, {
        linkifyUrls: true,
        linkTitles: post.linkTitles
      })
    : '';
  const effectiveTextHtml = effectiveText
    ? formatTextWithTickers(effectiveText, undefined, {
        linkifyUrls: true,
        linkTitles: post.linkTitles
      })
    : '';

  renderMantineThreadsPopupCard(el, {
    avatarUrl: post.avatarUrl || '',
    displayName,
    userHandle,
    showUserHandle,
    isPinned: Boolean(post.isPinned),
    isRetweet: Boolean(post.isRetweet),
    effectiveTextHtml,
    images,
    hasQuote,
    quoteAuthor,
    quoteUrl: post.quoteUrl || '',
    quoteTextHtml,
    timeDisplay,
    postUrl: post.url || '',
    labels: {
      tagPinned: t('slot.tagPinned'),
      tagRepost: t('slot.tagRepost'),
      imageAlt: t('slot.imageAlt'),
      viewOriginalImageTitle: t('popup.viewOriginalImageTitle'),
      quoteTag: t('popup.quoteTag'),
      viewQuotedPost: t('popup.viewQuotedPost'),
      openOnThreads: t('popup.openOnThreads')
    },
    onOpenExternal: (url) => {
      if (url) shell.openExternal(url);
    }
  });

  resolvePopupLinksInElement(el, post);
}

function openThreadsPopup(post) {
  const el = getThreadsSlotEl();
  if (!el) return;

  if (activePostId) deactivateSlot(activePostId);
  if (discordSlotEl) discordSlotEl.classList.remove('is-active');
  activePostId = null;
  currentPost = post;

  renderThreadsCardInto(el, post);
  el.classList.add('is-active');

  const loadingEl = getLoadingEl();
  if (loadingEl) loadingEl.style.display = 'none';
  openOverlay();
}

function openPostPopup(post) {
  if (!post) return;
  if (post.source === 'discord') {
    openDiscordPopup(post);
    return;
  }
  if (post.source === 'threads') {
    openThreadsPopup(post);
    return;
  }

  const overlay = getOverlay();
  const loadingEl = getLoadingEl();
  if (!overlay) return;

  const rawPostId = getPostId(post);
  const postId = post.isMerged && rawPostId
    ? `merged_${rawPostId}_${Array.isArray(post.mergedPosts) ? post.mergedPosts.length : 2}`
    : rawPostId;
  currentPost = post;

  // Hide whatever was shown before.
  if (discordSlotEl) discordSlotEl.classList.remove('is-active');
  if (threadsSlotEl) threadsSlotEl.classList.remove('is-active');
  if (activePostId && activePostId !== postId) {
    deactivateSlot(activePostId);
  }

  if (!postId) {
    if (loadingEl) loadingEl.style.display = 'none';
    openOverlay();
    return;
  }

  const entry = ensureSlot(postId, post);
  if (!entry) return;

  activePostId = postId;
  entry.el.classList.add('is-active');
  openOverlay();

  // If this is a member-only post or a merged multi-post bubble, Twitter's single-post public embed
  // iframe cannot represent it. Immediately render the rich card with the full text and images.
  if (isMemberOnlyPost(post) || post.isMerged) {
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

  renderSlot(entry, postId, { priority: true }).then(() => {
    if (activePostId !== postId) return;
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

function closePostPopup() {
  const overlay = getOverlay();
  const loadingEl = getLoadingEl();

  if (overlay) {
    overlay.classList.add('is-closed');
    overlay.setAttribute('aria-hidden', 'true');
  }

  // Only hide the active slot; the rendered iframe stays in the DOM so that
  // reopening the same post is instant.
  if (activePostId) deactivateSlot(activePostId);
  if (discordSlotEl) discordSlotEl.classList.remove('is-active');
  if (threadsSlotEl) threadsSlotEl.classList.remove('is-active');
  activePostId = null;

  if (loadingEl) loadingEl.style.display = 'none';
  currentPost = null;
}

// Twitter bakes the colour scheme into the embed at creation time, so every
// pre-rendered card has to be thrown away when the theme flips.
function clearPostWidgetCache() {
  const wasOpen = isPostPopupOpen();
  const post = currentPost;

  renderQueue.clear();
  for (const entry of embedSlots.values()) {
    entry.disposed = true;
    if (entry.el && entry.el.parentNode) {
      entry.el.parentNode.removeChild(entry.el);
    }
  }
  embedSlots.clear();
  activePostId = null;

  if (wasOpen && post) {
    openPostPopup(post);
  }
}

function setupEmbedIntegration() {
  installRendererEmbedHooks({
    onOpenExternal: (url) => {
      if (url) shell.openExternal(url);
    },
    onEmbedResize: ({ tweetId, embedId, height }) => {
      if (!height || height <= 0) return;
      let iframe = embedId ? document.getElementById(embedId) : null;
      if (!iframe && tweetId) {
        const entry = embedSlots.get(String(tweetId));
        if (entry && entry.el) {
          iframe = entry.el.querySelector('iframe');
        }
      }
      if (iframe) {
        iframe.style.height = `${Math.ceil(height)}px`;
      }
    }
  });
}

setupEmbedIntegration();

function initPostPopup() {
  setupEmbedIntegration();
  const overlay = getOverlay();

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // Clicking the card itself shouldn't dismiss the popup.
      if (e.target.closest('.tweet-embed-slot')) return;
      if (e.target.closest('.tweet-popup-loading')) return;
      closePostPopup();
    });
  }

  const handleEscKey = (e) => {
    if (e.key === 'Escape' && isPostPopupOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closePostPopup();
    }
  };

  window.addEventListener('keydown', handleEscKey, true);
  document.addEventListener('keydown', handleEscKey, true);

  // Escape needs to work even while focus sits inside the Twitter iframe,
  // which the renderer can't observe directly.
  if (ipcRenderer) {
    ipcRenderer.on('global-escape', () => {
      if (isPostPopupOpen()) closePostPopup();
    });
  }
}

module.exports = {
  initPostPopup,
  openPostPopup,
  closePostPopup,
  isPostPopupOpen,
  prefetchPost,
  clearPostWidgetCache
};
