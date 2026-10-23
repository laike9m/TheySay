const { shell } = require('electron');
const { MAX_SLOTS, DEFAULT_SLOT_MUTED } = require('../core/constants');
const { escapeHtml, showToast, formatFetchTime, stripDiscordEditedText } = require('../core/utils');
const {
  getPostId,
  getPostKey,
  cleanInlineEntityNewlines,
  processAndSortPosts,
  getPostDateKey,
  getPostDateLabel,
  formatTelegramTime,
  shouldShowPostPopup,
  isPostWithQuote,
  isMemberOnlyPost,
  ensureSlotReadTracking,
  recordSlotReadPosts,
  serializeSlotReadTracking,
  resetSlotReadTracking
} = require('../core/post');
const { openPostPopup, prefetchPost } = require('./popup');
const { fetchFullTweetData } = require('./tweet_embed');
const {
  getSavedHandles,
  saveHandles,
  getMutedSlots,
  saveMutedSlots,
  getTargetCacheEntry,
  saveTargetCacheEntry,
  getSlotCache,
  saveSlotCache,
  saveAllSlotCache,
  getShowMemberOnlyPosts
} = require('../core/storage');
const { getOrCreateSlotWebview } = require('../data/webview');
const {
  SOURCE_DISCORD,
  SOURCE_THREADS,
  detectSourceType,
  isAmbiguousBareHandle,
  probeHandlePlatforms,
  normalizeTwitterHandle,
  normalizeThreadsHandle,
  formatThreadsSlotInput,
  parseDiscordChannelUrl,
  getCanonicalTargetKey
} = require('../core/source');
const { requestNotificationPermission } = require('./notification');
const { formatTextWithTickers } = require('../core/ticker');
const {
  t,
  translateAttachmentLabel,
  isImageAttachmentLabel,
  normalizeDiscordChannelFallback,
  normalizeMediaOnlyText
} = require('../core/i18n');

const BELL_OFF_SVG = `
  <svg class="mute-icon bell-off" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    <path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path>
    <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path>
    <path d="M18 8a6 6 0 0 0-9.33-5"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
`;

const BELL_ON_SVG = `
  <svg class="mute-icon bell-on" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
`;

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
          <span class="slot-drag-indicator" title="${escapeHtml(t('slot.dragHandleTitle'))}">⠿</span>

          <!-- User Profile Avatar in Header -->
          <div class="slot-avatar" id="slot-avatar-${index}" title="${escapeHtml(t('slot.avatarTitle'))}">
            <img class="slot-avatar-img" id="slot-avatar-img-${index}" referrerpolicy="no-referrer" alt="" style="display: none;">
            <span class="slot-avatar-placeholder" id="slot-avatar-placeholder-${index}">👤</span>
          </div>

          <!-- Identity Area: Displays Author Name / Handle next to Avatar, or Input Field -->
          <div class="slot-identity-area" id="slot-identity-${index}">
            <!-- Author display badge next to avatar (shown when posts loaded) -->
            <div class="slot-author-header" id="slot-author-header-${index}" style="display: none;" title="${escapeHtml(t('slot.clickEditAccount'))}">
              <span class="slot-author-name" id="author-name-${index}"></span>
              <span class="slot-author-handle" id="author-handle-${index}"></span>
              <span class="slot-author-edit-hint" title="${escapeHtml(t('slot.editHint'))}">✎</span>
            </div>
            <span class="slot-unread-badge" id="slot-unread-badge-${index}" style="display: none;"></span>

            <!-- Handle input field (shown initially or when editing) -->
            <div class="slot-input-wrapper" id="slot-input-wrapper-${index}">
              <span class="slot-input-prefix" id="slot-input-prefix-${index}">@</span>
              <input type="text" class="slot-handle-input" id="handle-input-${index}" placeholder="${escapeHtml(t('slot.inputPlaceholder'))}" autocomplete="off" spellcheck="false">
              <button class="slot-btn-clear" id="btn-clear-${index}" title="${escapeHtml(t('slot.clearBtnTitle'))}" style="display: none;">✕</button>
            </div>
          </div>

          <button class="slot-btn-mute is-muted" id="btn-mute-${index}" title="${escapeHtml(t('slot.mutedTitle'))}" aria-label="${escapeHtml(t('slot.muteAriaLabel'))}" aria-pressed="false">
            <span class="mute-icon-wrap" id="mute-icon-${index}">${BELL_OFF_SVG}</span>
          </button>
          <button class="slot-btn-expand" id="btn-expand-${index}" title="${escapeHtml(t('slot.expandBtnTitle'))}">
            <span class="expand-icon" id="expand-icon-${index}">
              <svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="3" y2="21"></line>
              </svg>
            </span>
          </button>
          <!-- Platform Source Picker Dropdown (shown when a handle exists on both Twitter & Threads) -->
          <div class="slot-source-dropdown" id="slot-source-dropdown-${index}" style="display: none;"></div>
          <!-- Size Options Dropdown Popover Menu -->
          <div class="slot-size-menu" id="size-menu-${index}" style="display: none;"></div>
        </div>

        <!-- Scrollable Content Viewport -->
        <div class="slot-content-container" id="slot-content-${index}">
          <div class="slot-placeholder" id="slot-placeholder-${index}">
            <span class="slot-placeholder-icon">💬</span>
            <p>${escapeHtml(t('slot.placeholderText'))}</p>
          </div>
          <div class="slot-loading" id="slot-loading-${index}" style="display: none;">
            <div class="spinner-small"></div>
            <span class="slot-loading-text" id="slot-loading-text-${index}">${escapeHtml(t('slot.loadingText'))}</span>
          </div>
          <div class="slot-error" id="slot-error-${index}" style="display: none;"></div>
          <div class="slot-posts-list" id="slot-posts-list-${index}" style="display: none;"></div>
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

function getSlotSource(slot) {
  if (!slot) return 'twitter';
  if (slot.source) return slot.source;
  return detectSourceType(slot.handleInput ? slot.handleInput.value : '');
}

function isDiscordSlot(slot) {
  return getSlotSource(slot) === SOURCE_DISCORD;
}

function isThreadsSlot(slot) {
  return getSlotSource(slot) === SOURCE_THREADS;
}

function getSlotDisplayLabel(slot) {
  if (!slot) return t('slot.defaultChannelName');
  if (isDiscordSlot(slot)) {
    return normalizeDiscordChannelFallback(
      slot.sourceTitle || (slot.authorName && slot.authorName.innerText) || t('slot.defaultDiscordChannel')
    ).trim();
  }
  if (isThreadsSlot(slot)) {
    const h = slot.monitoredHandle || (slot.handleInput ? normalizeThreadsHandle(slot.handleInput.value) : '');
    return h ? `@${h} (Threads)` : t('slot.defaultChannelName');
  }
  const h = slot.monitoredHandle || (slot.handleInput ? normalizeTwitterHandle(slot.handleInput.value) : '');
  return h ? `@${h}` : t('slot.defaultChannelName');
}

function updateSlotMuteUI(slot) {
  if (!slot || !slot.btnMute) return;
  const isMuted = slot.isMuted !== false;
  slot.btnMute.classList.toggle('is-muted', isMuted);
  slot.btnMute.classList.toggle('is-unmuted', !isMuted);
  slot.btnMute.setAttribute('aria-pressed', String(!isMuted));
  slot.btnMute.setAttribute('aria-label', t('slot.muteAriaLabel'));

  if (slot.muteIcon) {
    slot.muteIcon.innerHTML = isMuted ? BELL_OFF_SVG : BELL_ON_SVG;
  }

  slot.btnMute.title = isMuted ? t('slot.mutedTitle') : t('slot.unmutedTitle');
}

function toggleSlotMute(slot, slots = []) {
  if (!slot) return;
  slot.isMuted = slot.isMuted === false ? true : false;
  updateSlotMuteUI(slot);
  saveMutedSlots(slots);

  if (Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
    persistSlot(slot, {
      handle: slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : ''),
      displayName: slot.authorName ? slot.authorName.innerText : '',
      userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
      posts: slot.loadedPosts,
      avatarUrl: (slot.avatarImg && slot.avatarImg.src) || ''
    }, slots);
  }

  if (!slot.isMuted) {
    requestNotificationPermission();
  }

  const label = getSlotDisplayLabel(slot);
  showToast(
    slot.isMuted ? t('slot.toastMuted', { label }) : t('slot.toastUnmuted', { label }),
    slot.isMuted ? 'info' : 'success',
    2000
  );
}

/**
 * Keeps the input affordances in sync with whatever the user is typing: a bare
 * Twitter handle reads as "@name", a Threads target as "@name" with Threads styling,
 * and a pasted Discord link as "#channel".
 */
function updateSlotSourceUI(slot) {
  if (!slot) return;
  const rawInput = slot.handleInput ? slot.handleInput.value : '';
  const detected = detectSourceType(rawInput);
  const isDiscord = detected === SOURCE_DISCORD || (!rawInput && slot.source === SOURCE_DISCORD);
  const isThreads = detected === SOURCE_THREADS || (!rawInput && slot.source === SOURCE_THREADS);

  if (slot.inputPrefix) {
    slot.inputPrefix.innerText = isDiscord ? '#' : '@';
    slot.inputPrefix.classList.toggle('is-discord', detected === SOURCE_DISCORD);
    slot.inputPrefix.classList.toggle('is-threads', detected === SOURCE_THREADS);
  }
  if (slot.avatarPlaceholder) {
    if (isDiscord || slot.source === SOURCE_DISCORD) {
      slot.avatarPlaceholder.innerText = '#';
    } else if (isThreads || slot.source === SOURCE_THREADS) {
      slot.avatarPlaceholder.innerText = '@';
    } else {
      slot.avatarPlaceholder.innerText = '👤';
    }
  }
  if (slot.card) {
    slot.card.classList.toggle('is-discord', isDiscord || slot.source === SOURCE_DISCORD);
    slot.card.classList.toggle('is-threads', isThreads || slot.source === SOURCE_THREADS);
  }
}

/**
 * Single funnel for slot persistence so that the source and the resolved
 * channel / server names are never dropped on the way into localStorage.
 */
function persistSlot(slot, payloadOrSlots = {}, maybeSlots = []) {
  const isDirectSlots = Array.isArray(payloadOrSlots);
  const payload = isDirectSlots ? {} : (payloadOrSlots || {});
  const slots = isDirectSlots ? payloadOrSlots : maybeSlots;

  const handle = payload.handle !== undefined
    ? payload.handle
    : (slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : ''));
  const displayName = payload.displayName !== undefined
    ? payload.displayName
    : (slot.authorName ? slot.authorName.innerText : '');
  const userHandle = payload.userHandle !== undefined
    ? payload.userHandle
    : (slot.authorHandle ? slot.authorHandle.innerText : '');
  const posts = Array.isArray(payload.posts)
    ? payload.posts
    : (Array.isArray(slot.loadedPosts) ? slot.loadedPosts : []);
  const avatarUrl = payload.avatarUrl !== undefined
    ? payload.avatarUrl
    : ((slot.avatarImg && slot.avatarImg.src) || '');

  recordSlotReadPosts(slot, posts);
  saveSlotCache(slot.index, {
    handle,
    displayName,
    userHandle,
    posts,
    avatarUrl,
    isMuted: slot.isMuted !== false,
    source: slot.source || 'twitter',
    sourceTitle: slot.sourceTitle || '',
    sourceSubtitle: slot.sourceSubtitle || '',
    ...serializeSlotReadTracking(slot)
  }, slots);
}

function sanitizeSingleLine(str) {
  return String(str || '')
    .split(/[\r\n]+/)[0]
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

function updateSlotFetchTimeUI(slot, timestamp) {
  if (!slot) return;
  const timeStr = formatFetchTime(timestamp);
  const isDiscord = isDiscordSlot(slot);
  const isThreads = isThreadsSlot(slot);

  if (slot.authorHeader) {
    let name;
    if (isDiscord) {
      const title = normalizeDiscordChannelFallback(slot.sourceTitle || t('slot.defaultDiscordChannel'));
      const subtitle = slot.sourceSubtitle || '';
      name = subtitle ? `${title} · ${subtitle}` : title;
    } else if (isThreads) {
      const h = slot.monitoredHandle || (slot.handleInput ? normalizeThreadsHandle(slot.handleInput.value) : '');
      name = `@${h} · Threads`;
    } else {
      name = `@${slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '')}`;
    }
    const editHint = isDiscord ? t('slot.clickEditChannel') : t('slot.clickEditAccount');
    slot.authorHeader.title = timeStr
      ? t('slot.lastFetchedTitle', { name, timeStr, editHint })
      : t('slot.noFetchedTitle', { name, editHint });
  }
}

function getSlotUnreadCount(slot) {
  if (!slot || !Array.isArray(slot.loadedPosts) || slot.loadedPosts.length === 0) return 0;
  const isDiscord = isDiscordSlot(slot);
  const isThreads = isThreadsSlot(slot);
  const showMemberOnly = getShowMemberOnlyPosts();
  const visible = (showMemberOnly || isDiscord || isThreads)
    ? slot.loadedPosts
    : slot.loadedPosts.filter(p => !isMemberOnlyPost(p));
  let count = 0;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] && visible[i].isUnread) count++;
  }
  return count;
}

function updateSlotUnreadBadge(slot) {
  if (!slot || !slot.unreadBadge) return;
  const isEditing = slot.inputWrapper && slot.inputWrapper.style.display === 'flex';
  const count = getSlotUnreadCount(slot);
  if (!isEditing && count > 0) {
    slot.unreadBadge.innerText = count > 99 ? '99+' : String(count);
    slot.unreadBadge.title = t('slot.unreadBadgeTitle', { count });
    slot.unreadBadge.style.display = 'inline-flex';
  } else {
    slot.unreadBadge.innerText = '';
    slot.unreadBadge.style.display = 'none';
  }
}

function markSlotPostsAsRead(slot, slots = []) {
  if (!slot) return false;
  let updated = false;
  if (Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
    slot.loadedPosts.forEach(p => {
      if (p && p.isUnread) {
        p.isUnread = false;
        updated = true;
      }
    });
    recordSlotReadPosts(slot, slot.loadedPosts);
  }
  if (slot.postsList) {
    const unreadBubbles = slot.postsList.querySelectorAll('.im-bubble.unread');
    if (unreadBubbles.length > 0) {
      unreadBubbles.forEach(b => b.classList.remove('unread'));
      updated = true;
    }
  }
  if (updated && Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
    persistSlot(slot, {
      handle: slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : ''),
      displayName: slot.authorName ? slot.authorName.innerText : '',
      userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
      posts: slot.loadedPosts,
      avatarUrl: (slot.avatarImg && slot.avatarImg.src) || ''
    }, slots);
  }
  updateSlotUnreadBadge(slot);
  return updated;
}

function showSlotLoading(slot, text) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'flex';
  slot.loadingText.innerText = text;
  slot.error.style.display = 'none';
  slot.postsList.style.display = 'none';
}

function showSlotError(slot, errorMsg) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'block';
  slot.error.innerHTML = `⚠️ ${errorMsg}`;
  slot.postsList.style.display = 'none';
}

// Stable per-author tint, so the same person keeps the same colour across
// refreshes without having to store anything.
function authorColor(name) {
  let hash = 0;
  const str = String(name || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 62%, 52%)`;
}

function buildMediaThumbsHtml(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  const maxVisible = 4;
  const visibleImages = images.slice(0, maxVisible);
  const extraCount = images.length - visibleImages.length;
  const gridClass = visibleImages.length > 1 ? 'multi' : 'single';

  let html = `<div class="im-media-grid ${gridClass}">`;
  visibleImages.forEach((imgUrl, idx) => {
    const isLastWithMore = extraCount > 0 && idx === visibleImages.length - 1;
    html += `<div class="im-media-thumb">`;
    html += `<img class="im-media-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(t('slot.imageAlt'))}" loading="lazy" referrerpolicy="no-referrer">`;
    if (isLastWithMore) {
      html += `<span class="im-media-more">+${extraCount}</span>`;
    }
    html += `</div>`;
  });
  html += '</div>';
  return html;
}

function buildDiscordBubbleHtml(msg, { showAuthor }) {
  const images = Array.isArray(msg.images) ? msg.images.filter(Boolean) : [];
  const rawText = stripDiscordEditedText(msg.text || '');
  const cleanReplyText = stripDiscordEditedText(msg.replyText || '');
  const chars = Array.from(rawText);
  const isLong = chars.length > 100;
  const previewText = isLong ? chars.slice(0, 100).join('') : rawText;

  let html = '';

  if (showAuthor && msg.displayName) {
    html += `<span class="im-author" style="color: ${authorColor(msg.displayName)}">${escapeHtml(msg.displayName)}</span>`;
    if (msg.isBot) html += '<span class="tweet-tag bot">BOT</span>';
  }

  if (cleanReplyText || msg.replyAuthor) {
    html += `
      <span class="im-reply-ref">
        <span class="im-reply-author">↩ ${escapeHtml(msg.replyAuthor || '')}</span>
        <span class="im-reply-text">${formatTextWithTickers(cleanReplyText)}</span>
      </span>
    `;
  }

  const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const visibleAttachments = images.length > 0
    ? rawAttachments.filter(a => !isImageAttachmentLabel(a))
    : rawAttachments;

  if (rawText) {
    html += isLong
      ? `<span class="im-text-content"><span class="im-text-preview">${formatTextWithTickers(previewText, rawText)}<span class="im-text-ellipsis">...</span></span></span>`
      : `<span class="im-text-content">${formatTextWithTickers(rawText)}</span>`;
  } else if (images.length > 0 && !cleanReplyText && !msg.replyAuthor && visibleAttachments.length === 0) {
    html += `<span class="im-text-content">${escapeHtml(t('scraper.mediaOnlyFallback'))}</span>`;
  }

  if (visibleAttachments.length > 0) {
    html += '<span class="im-attachments">';
    visibleAttachments.forEach(a => {
      html += `<span class="im-attachment-chip">${escapeHtml(translateAttachmentLabel(a))}</span>`;
    });
    html += '</span>';
  }

  return html;
}

function buildPostBubbleHtml(post) {
  const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
  if (typeof post.text === 'string' && post.text.includes('\n')) {
    post.text = cleanInlineEntityNewlines(post.text);
  }
  const rawText = normalizeMediaOnlyText((post.text || '').trim());
  const effectiveText = rawText || (images.length > 0 ? t('scraper.mediaOnlyFallback') : '');
  const chars = Array.from(effectiveText);
  const isLong = chars.length > 100;
  const previewText = isLong ? chars.slice(0, 100).join('') : effectiveText;

  let tagHtml = '';
  if (post.isPinned) tagHtml += `<span class="tweet-tag pinned">${escapeHtml(t('slot.tagPinned'))}</span>`;
  if (post.isRetweet) tagHtml += `<span class="tweet-tag repost">${escapeHtml(t('slot.tagRepost'))}</span>`;
  if (isPostWithQuote(post)) tagHtml += `<span class="tweet-tag quote">${escapeHtml(t('slot.tagQuote'))}</span>`;
  if (isMemberOnlyPost(post)) tagHtml += `<span class="tweet-tag member" title="${escapeHtml(t('slot.tagMemberOnlyTitle'))}">${escapeHtml(t('slot.tagMemberOnly'))}</span>`;

  let textHtml = '';
  if (effectiveText) {
    textHtml = isLong
      ? `<span class="im-text-content"><span class="im-text-preview">${formatTextWithTickers(previewText, effectiveText)}<span class="im-text-ellipsis">...</span></span></span>`
      : `<span class="im-text-content">${formatTextWithTickers(effectiveText)}</span>`;
  }

  return `${tagHtml}${textHtml}`;
}

/**
 * Renders a slot's feed.
 *
 * `meta` is only supplied by non-Twitter sources; when it is omitted the header
 * keeps deriving its identity from the first post, exactly as before.
 */
function renderSlotPosts(slot, posts, handle, avatarUrl = null, slots = [], meta = null) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.postsList.style.display = 'flex';

  ensureSlotReadTracking(slot);
  recordSlotReadPosts(slot, posts);
  slot.loadedPosts = posts;

  const isDiscord = !!(meta && meta.source === SOURCE_DISCORD);
  const isThreads = !!(meta && meta.source === SOURCE_THREADS);
  slot.source = isDiscord ? SOURCE_DISCORD : (isThreads ? SOURCE_THREADS : 'twitter');

  const firstPost = posts[0] || {};

  let displayName;
  let userHandle;

  if (isDiscord) {
    let rawTitle = meta && meta.title ? meta.title : (slot.sourceTitle || t('slot.defaultDiscordChannel'));
    if (rawTitle === '#频道' || rawTitle === '#channel') {
      rawTitle = '';
    }
    let rawSubtitle = meta && meta.subtitle !== undefined ? meta.subtitle : (slot.sourceSubtitle || '');

    let cleanChan = '';
    let cleanGuild = rawSubtitle;

    const rawLines = String(rawTitle).split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    if (rawLines.length >= 2) {
      const l0 = rawLines[0].replace(/^[#@]+/, '').replace(/[:：\s]+$/, '').trim();
      const l1 = rawLines[1].replace(/^[#@]+/, '').replace(/[:：\s]+$/, '').trim();
      if (l1) {
        cleanChan = l1;
        if (!cleanGuild || cleanGuild === l1) cleanGuild = l0;
      }
    }

    if (!cleanChan && (rawTitle.includes(':') || rawTitle.includes('：'))) {
      const cparts = rawTitle.split(/[:：]/);
      const p0 = cparts[0].replace(/^[#@]+/, '').trim();
      const p1 = cparts.slice(1).join(':').replace(/^[#@]+/, '').trim();
      if (p1) {
        cleanChan = p1;
        if (!cleanGuild || cleanGuild === p1) cleanGuild = p0;
      }
    }

    if (!cleanChan) {
      cleanChan = sanitizeSingleLine(rawTitle)
        .replace(/^[#@\s]+/, '')
        .replace(/[:：\s]+$/, '')
        .trim();
    }
    cleanChan = cleanChan.split(/[,，(（]/)[0].trim();

    if (cleanGuild) {
      cleanGuild = sanitizeSingleLine(cleanGuild)
        .replace(/\s*[-|]\s*Discord$/i, '')
        .trim();
      if (cleanGuild.toLowerCase() === cleanChan.toLowerCase()) {
        cleanGuild = '';
      }
    }

    displayName = cleanChan ? `#${cleanChan}` : t('slot.defaultDiscordChannel');
    userHandle = cleanGuild;

    slot.sourceTitle = displayName;
    slot.sourceSubtitle = userHandle;
    slot.authorName.innerText = displayName;
    slot.authorHandle.innerText = userHandle;
  } else {
    let rawName = sanitizeSingleLine(meta && meta.displayName ? meta.displayName : '');
    let rawHandle = sanitizeSingleLine(meta && meta.userHandle ? meta.userHandle : '');

    if (!rawName) {
      for (const p of posts) {
        if (p.displayName) {
          const cleaned = sanitizeSingleLine(p.displayName);
          if (cleaned && cleaned.toLowerCase() !== handle.toLowerCase()) {
            rawName = cleaned;
            break;
          }
        }
      }
    }

    if (!rawName && firstPost.displayName) {
      rawName = sanitizeSingleLine(firstPost.displayName);
    }

    if (!rawHandle) {
      for (const p of posts) {
        if (p.userHandle) {
          const cleanedH = sanitizeSingleLine(p.userHandle);
          if (cleanedH) {
            rawHandle = cleanedH;
            break;
          }
        }
      }
    }

    if (!rawHandle) {
      rawHandle = sanitizeSingleLine(firstPost.userHandle || (isThreads ? `threads:@${handle}` : `@${handle}`));
    }
    if (isThreads) {
      const bare = rawHandle.replace(/^@?threads:\s*@?/i, '').replace(/^@/, '');
      rawHandle = bare ? `threads:@${bare}` : `threads:@${handle}`;
    } else if (!rawHandle.startsWith('@') && rawHandle) {
      rawHandle = `@${rawHandle}`;
    }

    const bareHandle = rawHandle.replace(/^@?threads:\s*@?/i, '').replace(/^@/, '').toLowerCase();
    const bareName = rawName.replace(/^@?threads:\s*@?/i, '').replace(/^@/, '').toLowerCase();

    slot.sourceTitle = '';
    slot.sourceSubtitle = '';

    // Set author name next to avatar
    if (rawName && bareName !== bareHandle) {
      displayName = rawName;
      userHandle = rawHandle;
      slot.authorName.innerText = displayName;
      slot.authorHandle.innerText = userHandle;
    } else {
      displayName = rawHandle || (isThreads ? `threads:@${handle}` : `@${handle}`);
      userHandle = '';
      slot.authorName.innerText = displayName;
      slot.authorHandle.innerText = '';
    }
  }

  updateSlotSourceUI(slot);

  // Switch to author badge view in header
  if (slot.authorHeader) slot.authorHeader.style.display = 'flex';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'none';
  updateSlotUnreadBadge(slot);

  // Update header avatar
  if (avatarUrl) {
    updateSlotAvatar(slot, avatarUrl);
  }

  slot.postsList.innerHTML = '';

  const finalAvatar = avatarUrl || (slot.avatarImg && slot.avatarImg.src) || '';

  const markBubbleAsRead = (postObj, bubbleEl) => {
    let changed = false;
    if (bubbleEl && bubbleEl.classList.contains('unread')) {
      bubbleEl.classList.remove('unread');
      changed = true;
    }
    if (postObj && postObj.isUnread) {
      postObj.isUnread = false;
      changed = true;
    }
    const targetKey = getPostKey(postObj);
    if (targetKey && Array.isArray(slot.loadedPosts)) {
      slot.loadedPosts.forEach(p => {
        if (p && getPostKey(p) === targetKey && p.isUnread) {
          p.isUnread = false;
          changed = true;
        }
      });
    }
    if (changed) {
      recordSlotReadPosts(slot, slot.loadedPosts);
      updateSlotUnreadBadge(slot);
      persistSlot(slot, { handle, displayName, userHandle, posts: slot.loadedPosts, avatarUrl: finalAvatar }, slots);
    }
  };

  const showMemberOnly = getShowMemberOnlyPosts();
  const displayPosts = (showMemberOnly || isDiscord || isThreads)
    ? posts
    : posts.filter(p => !isMemberOnlyPost(p));

  let lastDateKey = null;
  let lastAuthorName = null;

  displayPosts.forEach((post) => {
    if (!post.source && slot.source) {
      post.source = slot.source;
    }

    const dateKey = getPostDateKey(post);
    const dateLabel = getPostDateLabel(post);
    let startedNewDay = false;

    if (dateKey && dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      startedNewDay = true;
      const dateDivider = document.createElement('div');
      dateDivider.className = 'im-date-divider';
      dateDivider.innerHTML = `<span class="im-date-pill">${escapeHtml(dateLabel)}</span>`;
      slot.postsList.appendChild(dateDivider);
    }

    const bubble = document.createElement('div');
    bubble.className = 'im-bubble';
    if (post.isUnread) {
      bubble.classList.add('unread');
    }
    if (isMemberOnlyPost(post)) {
      bubble.classList.add('is-member-only');
    }

    // Restore to normal bubble color once hovered or clicked
    bubble.addEventListener('mouseenter', () => {
      markBubbleAsRead(post, bubble);
    });

    // Store avatar and author reference on post object if available
    if (!post.avatarUrl && finalAvatar) {
      post.avatarUrl = finalAvatar;
    }
    if (!isDiscord) {
      if (!post.displayName && displayName) post.displayName = displayName;
      if (!post.userHandle && userHandle) post.userHandle = userHandle;
    }

    const timeDisplay = formatTelegramTime(post);
    const linkTitle = isDiscord
      ? t('slot.openOriginalDiscord')
      : (isThreads ? t('slot.openOriginalThreads') : t('slot.openOriginalPost'));

    let bodyHtml;
    if (isDiscord) {
      // Consecutive messages from the same person collapse into one visual
      // group, the way every chat client renders them.
      const showAuthor = startedNewDay || post.displayName !== lastAuthorName;
      bodyHtml = buildDiscordBubbleHtml(post, { showAuthor });
      bubble.classList.add('discord');
      if (!showAuthor) bubble.classList.add('grouped');
      lastAuthorName = post.displayName;
    } else {
      bodyHtml = buildPostBubbleHtml(post);
      if (isThreads) bubble.classList.add('threads');
    }

    const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
    const hasMedia = images.length > 0;
    const timeHtml = `<span class="im-time">${escapeHtml(timeDisplay)}</span>`;
    const linkHtml = post.url
      ? `<a class="im-btn-link" data-url="${escapeHtml(post.url)}" title="${escapeHtml(linkTitle)}">↗</a>`
      : '';

    if (hasMedia) {
      bubble.classList.add('has-media');
      bubble.innerHTML = `<div class="im-bubble-left">${bodyHtml}${timeHtml}</div>${buildMediaThumbsHtml(images)}${linkHtml}`;
    } else {
      bubble.innerHTML = `${bodyHtml}${timeHtml}${linkHtml}`;
    }

    // Handle inline image load (keep bottom scroll alignment) and error fallback
    const mediaImgs = bubble.querySelectorAll('.im-media-img');
    if (mediaImgs.length > 0) {
      mediaImgs.forEach((imgEl) => {
        imgEl.addEventListener('load', () => {
          if (slot.contentContainer) {
            const c = slot.contentContainer;
            if (c.scrollHeight - c.scrollTop - c.clientHeight < 220) {
              c.scrollTop = c.scrollHeight;
            }
          }
        });
        imgEl.addEventListener('error', () => {
          if (!imgEl.dataset.retried) {
            imgEl.dataset.retried = '1';
            const src = imgEl.getAttribute('src') || '';
            if (src.includes('media.discordapp.net/attachments/')) {
              imgEl.src = src.replace('media.discordapp.net/attachments/', 'cdn.discordapp.com/attachments/');
              return;
            }
            if (src.includes('cdn.discordapp.com/attachments/')) {
              imgEl.src = src.replace('cdn.discordapp.com/attachments/', 'media.discordapp.net/attachments/');
              return;
            }
          }
          imgEl.style.display = 'none';
          const thumb = imgEl.closest('.im-media-thumb');
          if (thumb) thumb.style.display = 'none';
          const grid = imgEl.closest('.im-media-grid');
          if (grid && !Array.from(grid.querySelectorAll('.im-media-img')).some(el => el.style.display !== 'none')) {
            grid.style.display = 'none';
            bubble.classList.remove('has-media');
          }
        });
      });
    }

    // Open external post link (hover button in top-right)
    if (post.url) {
      const linkBtn = bubble.querySelector('.im-btn-link');
      if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          markBubbleAsRead(post, bubble);
          shell.openExternal(post.url);
        });
      }
    }

    // Click on bubble to open centered popup (click-to-open, no hover trigger)
    const hasPopup = shouldShowPostPopup(post);
    if (hasPopup) {
      bubble.classList.add('has-popup');
      if (!isDiscord && !isThreads) {
        // Hovering is a strong hint the user is about to click, so jump this
        // post to the front of the embed render queue. Discord and Threads messages
        // are rendered locally and need no warm-up.
        bubble.addEventListener('mouseenter', () => {
          prefetchPost(post, { priority: true });
        });
      }
      bubble.addEventListener('click', (e) => {
        if (e.target.closest('.im-btn-link')) return;
        markBubbleAsRead(post, bubble);
        openPostPopup(post);
      });
    } else {
      bubble.addEventListener('click', () => {
        markBubbleAsRead(post, bubble);
      });
    }

    slot.postsList.appendChild(bubble);
  });

  if (displayPosts.length === 0 && posts.length > 0 && !isDiscord && !isThreads) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'im-filtered-empty-notice';
    emptyNotice.innerText = t('slot.hiddenMemberPosts', { count: posts.length });
    slot.postsList.appendChild(emptyNotice);
  }

  // Auto-scroll to bottom to show the latest messages (Telegram style)
  requestAnimationFrame(() => {
    if (slot.contentContainer) {
      slot.contentContainer.scrollTop = slot.contentContainer.scrollHeight;
    }
  });

  persistSlot(slot, { handle, displayName, userHandle, posts, avatarUrl: finalAvatar }, slots);

  // Background idle prefetch for posts eligible for popups.
  // The list auto-scrolls to the bottom, so the newest posts are the ones on
  // screen and the most likely to be clicked.
  if (!isDiscord && !isThreads && Array.isArray(posts) && posts.length > 0) {
    const popPosts = posts.filter(shouldShowPostPopup);
    if (popPosts.length > 0) {
      setTimeout(() => {
        popPosts.slice(-4).reverse().forEach((p) => prefetchPost(p));
      }, 1000);
    }
    backfillTwitterSlotImages(slot, slots);
  }
}

async function backfillTwitterSlotImages(slot, slots = []) {
  if (!slot || slot._isBackfillingImages) return;
  if (isDiscordSlot(slot) || isThreadsSlot(slot)) return;
  const posts = Array.isArray(slot.loadedPosts) ? slot.loadedPosts : [];
  if (posts.length === 0) return;

  const toBackfill = [];
  for (const p of posts) {
    if (!p) continue;
    if (Array.isArray(p.images) && p.images.length > 0) {
      p.imagesBackfilled = true;
      continue;
    }
    if (p.imagesBackfilled) continue;
    const postId = getPostId(p);
    if (postId && /^\d+$/.test(postId)) {
      toBackfill.push({ post: p, postId });
    }
  }

  if (toBackfill.length === 0) return;
  slot._isBackfillingImages = true;
  const targetHandleAtStart = normalizeTwitterHandle(
    slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '')
  ).toLowerCase();

  let anyImagesFound = false;
  let anyCompleted = false;

  try {
    const batchSize = 4;
    for (let i = 0; i < toBackfill.length; i += batchSize) {
      const batch = toBackfill.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async ({ post, postId }) => {
          try {
            const data = await fetchFullTweetData(postId);
            if (data) {
              post.imagesBackfilled = true;
              anyCompleted = true;
              if (Array.isArray(data.images) && data.images.length > 0) {
                post.images = data.images;
                anyImagesFound = true;
              } else if (!Array.isArray(post.images)) {
                post.images = [];
              }
            }
          } catch (_) {}
        })
      );
    }

    const currentHandle = normalizeTwitterHandle(
      slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '')
    ).toLowerCase();
    if (currentHandle !== targetHandleAtStart) return;

    if (anyImagesFound && Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
      const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
      const avatarUrl = (slot.avatarImg && slot.avatarImg.src) || null;
      const meta = {
        source: 'twitter',
        displayName: slot.authorName ? slot.authorName.innerText : '',
        userHandle: slot.authorHandle ? slot.authorHandle.innerText : `@${handle}`
      };
      renderSlotPosts(slot, slot.loadedPosts, handle, avatarUrl, slots, meta);
      archiveSlotScrapedData(slot);
    } else if (anyCompleted && Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
      const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
      const avatarUrl = (slot.avatarImg && slot.avatarImg.src) || null;
      persistSlot(slot, {
        handle,
        displayName: slot.authorName ? slot.authorName.innerText : '',
        userHandle: slot.authorHandle ? slot.authorHandle.innerText : `@${handle}`,
        posts: slot.loadedPosts,
        avatarUrl
      }, slots);
      archiveSlotScrapedData(slot);
    }
  } finally {
    slot._isBackfillingImages = false;
  }
}


function archiveSlotScrapedData(slot) {
  if (!slot || !Array.isArray(slot.loadedPosts) || slot.loadedPosts.length === 0) return;
  const rawInput = slot.handleInput ? slot.handleInput.value.trim() : '';
  const handle = slot.monitoredHandle || rawInput;
  if (!handle) return;
  const source = slot.source || detectSourceType(rawInput || handle);
  recordSlotReadPosts(slot, slot.loadedPosts);
  saveTargetCacheEntry(handle, {
    handle,
    displayName: slot.authorName ? slot.authorName.innerText : '',
    userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
    posts: slot.loadedPosts,
    avatarUrl: (slot.avatarImg && slot.avatarImg.src) || '',
    isMuted: slot.isMuted !== false,
    source,
    sourceTitle: slot.sourceTitle || '',
    sourceSubtitle: slot.sourceSubtitle || '',
    lastFetchedAt: slot.lastFetchedAt || Date.now(),
    ...serializeSlotReadTracking(slot)
  });
}

function restoreSlotFromTargetCache(slot, rawInput, slots = [], sourceOverride = null) {
  if (!slot) return false;
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return false;

  const detected = sourceOverride || detectSourceType(trimmed);
  const isDiscord = detected === SOURCE_DISCORD;
  const isThreads = detected === SOURCE_THREADS;
  const source = isDiscord ? SOURCE_DISCORD : (isThreads ? SOURCE_THREADS : 'twitter');
  const cached = getTargetCacheEntry(trimmed, source);
  const cachedPosts = cached && (Array.isArray(cached.posts) ? cached.posts : cached.tweets);
  if (!cached || !Array.isArray(cachedPosts) || cachedPosts.length === 0) {
    return false;
  }

  const targetHandle = isDiscord
    ? trimmed
    : (isThreads ? normalizeThreadsHandle(trimmed) : normalizeTwitterHandle(trimmed));
  resetSlotReadTracking(slot);
  ensureSlotReadTracking(slot, cached);
  slot.source = source;
  slot.monitoredHandle = targetHandle;
  slot.sourceTitle = cached.sourceTitle || '';
  slot.sourceSubtitle = cached.sourceSubtitle || '';
  if (cached.lastFetchedAt) {
    slot.lastFetchedAt = cached.lastFetchedAt;
    updateSlotFetchTimeUI(slot, cached.lastFetchedAt);
  }
  if (cached.avatarUrl) {
    updateSlotAvatar(slot, cached.avatarUrl);
  } else {
    updateSlotAvatar(slot, null);
  }

  const sorted = processAndSortPosts(cachedPosts);
  recordSlotReadPosts(slot, sorted);
  const meta = isDiscord
    ? {
        source: SOURCE_DISCORD,
        title: cached.sourceTitle || cached.displayName || '#频道',
        subtitle: cached.sourceSubtitle || cached.userHandle || ''
      }
    : {
        source,
        displayName: sanitizeSingleLine(cached.displayName || ''),
        userHandle: sanitizeSingleLine(cached.userHandle || `@${targetHandle}`)
      };

  renderSlotPosts(slot, sorted, targetHandle, cached.avatarUrl || null, slots, meta);
  return true;
}

function resetSlotForNewTarget(slot, newRawInput = '', slots = []) {
  if (!slot) return;
  archiveSlotScrapedData(slot);
  resetSlotReadTracking(slot);
  const trimmed = String(newRawInput || '').trim();
  if (slot.handleInput) {
    slot.handleInput.value = trimmed;
  }
  if (slot.btnClear) {
    slot.btnClear.style.display = trimmed.length > 0 ? 'flex' : 'none';
  }
  updateSlotAvatar(slot, null);
  slot.loadedPosts = [];
  const nextSource = detectSourceType(trimmed);
  slot.monitoredHandle = trimmed
    ? (nextSource === SOURCE_DISCORD
        ? trimmed
        : (nextSource === SOURCE_THREADS ? normalizeThreadsHandle(trimmed) : normalizeTwitterHandle(trimmed)))
    : '';
  slot.source = nextSource;
  slot.sourceTitle = '';
  slot.sourceSubtitle = '';
  slot.lastFetchedAt = null;
  slot.postsList.innerHTML = '';
  slot.postsList.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.placeholder.style.display = 'flex';
  slot.authorName.innerText = '';
  slot.authorHandle.innerText = '';
  if (slot.authorHeader) slot.authorHeader.style.display = 'none';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
  updateSlotUnreadBadge(slot);
  updateSlotSourceUI(slot);
  saveSlotCache(slot.index, null, slots);
}

function clearSlot(slot, { slots } = {}) {
  archiveSlotScrapedData(slot);
  resetSlotReadTracking(slot);
  slot.handleInput.value = '';
  if (slot.btnClear) slot.btnClear.style.display = 'none';
  updateSlotAvatar(slot, null);
  slot.isMuted = DEFAULT_SLOT_MUTED;
  updateSlotMuteUI(slot);
  if (slots) {
    saveHandles(slots);
    saveMutedSlots(slots);
  }
  saveSlotCache(slot.index, null, slots);
  slot.loadedPosts = [];
  slot.monitoredHandle = '';
  slot.source = '';
  slot.sourceTitle = '';
  slot.sourceSubtitle = '';
  slot.postsList.innerHTML = '';
  slot.postsList.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.placeholder.style.display = 'flex';
  slot.authorName.innerText = '';
  slot.authorHandle.innerText = '';
  if (slot.authorHeader) slot.authorHeader.style.display = 'none';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
  updateSlotUnreadBadge(slot);
  updateSlotSourceUI(slot);
  showToast(t('slot.toastCleared'), 'success', 2000);
}

function slotHasContent(slot) {
  if (!slot) return false;
  const handle = slot.handleInput ? slot.handleInput.value.trim() : '';
  const hasPosts = (slot.loadedPosts && slot.loadedPosts.length > 0);
  return handle.length > 0 || hasPosts;
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
    slot.btnExpand.title = t('slot.currentSizeTitle', { r, c });
  } else {
    slot.card.classList.remove('is-priority');
    slot.btnExpand.classList.remove('expanded');
    slot.expandIcon.innerHTML = `<svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="3" y2="21"></line></svg>`;
    slot.btnExpand.title = t('slot.resizeCardTitle');
  }
}

function closeSlotSourceDropdown(slot) {
  if (!slot || !slot.sourceDropdown) return;
  slot.sourceDropdown.style.display = 'none';
  slot.sourceDropdown.innerHTML = '';
  slot._dropdownHandle = '';
  slot._dropdownOnSelect = null;
}

function closeAllSourceDropdowns(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(s => closeSlotSourceDropdown(s));
}

function applyPlatformSelectionAndFetch(slot, chosenSource, probeRes, { slots, onFetch } = {}) {
  if (!slot) return;
  closeSlotSourceDropdown(slot);
  const twitter = (probeRes && probeRes.twitter) || {};
  const threads = (probeRes && probeRes.threads) || {};
  const rawVal = slot.handleInput ? slot.handleInput.value.trim() : '';

  if (chosenSource === SOURCE_THREADS) {
    const thHandle = threads.handle || normalizeThreadsHandle(rawVal);
    if (slot.handleInput) {
      slot.handleInput.value = formatThreadsSlotInput(thHandle);
    }
    slot.source = SOURCE_THREADS;
    updateSlotSourceUI(slot);
    if (threads.avatarUrl) {
      updateSlotAvatar(slot, threads.avatarUrl);
    }
    if (slots) saveHandles(slots);
    if (slot.handleInput) slot.handleInput.blur();
    if (typeof onFetch === 'function') {
      onFetch(slot.index, { skipPlatformProbe: true, prefetchedMeta: threads });
    }
    return;
  }

  const twHandle = twitter.handle || normalizeTwitterHandle(rawVal);
  if (slot.handleInput) {
    slot.handleInput.value = twHandle;
  }
  slot.source = 'twitter';
  updateSlotSourceUI(slot);
  if (twitter.avatarUrl) {
    updateSlotAvatar(slot, twitter.avatarUrl);
  }
  if (slots) saveHandles(slots);
  if (slot.handleInput) slot.handleInput.blur();
  if (typeof onFetch === 'function') {
    onFetch(slot.index, { skipPlatformProbe: true, prefetchedMeta: twitter });
  }
}

function showSlotSourceDropdown(slot, { handle, twitter, threads, onSelect, slots } = {}) {
  if (!slot || !slot.sourceDropdown) return;
  if (slots) {
    closeAllSourceDropdowns(slots);
    slots.forEach(s => {
      if (s.sizeMenu) s.sizeMenu.style.display = 'none';
    });
  }

  const cleanHandle = String(handle || '').replace(/^@+/, '');
  const twName = (twitter && twitter.displayName) || cleanHandle;
  const twHandle = (twitter && twitter.handle) || cleanHandle;
  const twAvatar = (twitter && twitter.avatarUrl) || '';

  const thName = (threads && threads.displayName) || cleanHandle;
  const thHandle = (threads && threads.handle) || cleanHandle.toLowerCase();
  const thAvatar = (threads && threads.avatarUrl) || '';

  if (slot.authorHeader) slot.authorHeader.style.display = 'none';
  if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';

  slot.sourceDropdown.innerHTML = `
    <div class="source-dropdown-title">${escapeHtml(t('slot.choosePlatformTitle', { handle: cleanHandle }))}</div>
    <button type="button" class="source-dropdown-item" data-source="twitter">
      <div class="source-dropdown-avatar-wrap">
        ${twAvatar
          ? `<img class="source-dropdown-avatar" src="${escapeHtml(twAvatar)}" alt="" referrerpolicy="no-referrer">`
          : '<span class="source-dropdown-avatar-fallback">𝕏</span>'}
      </div>
      <div class="source-dropdown-info">
        <span class="source-dropdown-name">${escapeHtml(twName)}</span>
        <span class="source-dropdown-handle">@${escapeHtml(twHandle)}</span>
      </div>
      <span class="source-dropdown-badge twitter">${escapeHtml(t('slot.platformTwitterBadge'))}</span>
    </button>
    <button type="button" class="source-dropdown-item" data-source="threads">
      <div class="source-dropdown-avatar-wrap">
        ${thAvatar
          ? `<img class="source-dropdown-avatar" src="${escapeHtml(thAvatar)}" alt="" referrerpolicy="no-referrer">`
          : '<span class="source-dropdown-avatar-fallback">@</span>'}
      </div>
      <div class="source-dropdown-info">
        <span class="source-dropdown-name">${escapeHtml(thName)}</span>
        <span class="source-dropdown-handle">threads:@${escapeHtml(thHandle)}</span>
      </div>
      <span class="source-dropdown-badge threads">${escapeHtml(t('slot.platformThreadsBadge'))}</span>
    </button>
  `;

  slot.sourceDropdown.style.display = 'flex';
  slot._dropdownHandle = cleanHandle.toLowerCase();
  slot._dropdownOnSelect = onSelect;

  slot.sourceDropdown.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  slot.sourceDropdown.querySelectorAll('.source-dropdown-avatar').forEach(imgEl => {
    imgEl.addEventListener('error', () => {
      imgEl.style.display = 'none';
    });
  });

  slot.sourceDropdown.querySelectorAll('.source-dropdown-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chosenSource = btn.getAttribute('data-source');
      const cb = slot._dropdownOnSelect;
      closeSlotSourceDropdown(slot);
      if (typeof cb === 'function') {
        cb(chosenSource);
      }
    });
  });
}

function closeAllSizeMenus(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(s => {
    if (s.sizeMenu) s.sizeMenu.style.display = 'none';
    closeSlotSourceDropdown(s);
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
    { r: 1, c: 1, label: '1 × 1', desc: t('slot.size1x1Desc') },
    { r: 2, c: 1, label: '2 × 1', desc: t('slot.size2x1Desc') },
    { r: 3, c: 1, label: '3 × 1', desc: t('slot.size3x1Desc') },
    { r: 2, c: 2, label: '2 × 2', desc: t('slot.size2x2Desc') }
  ];

  let menuHtml = `<div class="size-menu-title">${escapeHtml(t('slot.sizeMenuTitle'))}</div>`;

  options.forEach(opt => {
    const key = `${opt.r}x${opt.c}`;
    const isActive = (curKey === key);
    const disabled = (opt.r > currentRows || opt.c > currentCols);
    let hint = opt.desc;
    if (opt.r > currentRows) hint = t('slot.needRows', { r: opt.r });
    else if (opt.c > currentCols) hint = t('slot.needCols', { c: opt.c });

    menuHtml += `
      <button class="size-menu-item ${isActive ? 'active' : ''}" data-r="${opt.r}" data-c="${opt.c}" ${disabled ? 'style="opacity: 0.45;"' : ''}>
        <div>
          <span class="size-label">${opt.label}</span>
          <span class="size-desc">${escapeHtml(hint)}</span>
        </div>
        ${isActive ? '<span class="size-check">✓</span>' : ''}
      </button>
    `;
  });

  menuHtml += `
    <div class="size-menu-divider"></div>
    <button class="size-menu-item danger" data-action="clear">
      <div>
        <span class="size-label">${escapeHtml(t('slot.clearSlotLabel'))}</span>
        <span class="size-desc">${escapeHtml(t('slot.clearSlotDesc'))}</span>
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
    updateSlotUnreadBadge(slot);
    slot.handleInput.focus();
    slot.handleInput.select();
    updateClearVisibility();
  });

  if (slot.unreadBadge) {
    slot.unreadBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      markSlotPostsAsRead(slot, slots);
    });
  }

  // When handleInput loses focus or escape is pressed, revert to author badge if posts exist for same handle (or if left empty)
  slot.handleInput.addEventListener('blur', () => {
    if (slot.sourceDropdown && slot.sourceDropdown.style.display === 'flex') {
      return;
    }
    const val = slot.handleInput.value.trim();
    const monitored = (slot.monitoredHandle || '').trim();
    const isSameOrEmpty = !val || (monitored && getCanonicalTargetKey(val) === getCanonicalTargetKey(monitored, slot.source));
    if (isSameOrEmpty && slot.loadedPosts && slot.loadedPosts.length > 0 && slot.authorName.innerText.trim()) {
      if (!val && monitored) {
        slot.handleInput.value = slot.source === SOURCE_THREADS ? formatThreadsSlotInput(monitored) : monitored;
        updateClearVisibility();
        updateSlotSourceUI(slot);
      }
      slot.authorHeader.style.display = 'flex';
      slot.inputWrapper.style.display = 'none';
      updateSlotUnreadBadge(slot);
    }
  });

  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (slot._probeDebounceTimer) {
        clearTimeout(slot._probeDebounceTimer);
        slot._probeDebounceTimer = null;
      }
      if (slot.sourceDropdown && slot.sourceDropdown.style.display === 'flex') {
        e.preventDefault();
        e.stopPropagation();
        closeSlotSourceDropdown(slot);
        return;
      }
      if (slot.loadedPosts && slot.loadedPosts.length > 0 && slot.authorName.innerText.trim()) {
        if (slot.monitoredHandle) {
          slot.handleInput.value = slot.source === SOURCE_THREADS
            ? formatThreadsSlotInput(slot.monitoredHandle)
            : slot.monitoredHandle;
          saveHandles(slots);
          updateClearVisibility();
          updateSlotSourceUI(slot);
        }
        slot.authorHeader.style.display = 'flex';
        slot.inputWrapper.style.display = 'none';
        updateSlotUnreadBadge(slot);
      }
      return;
    }

    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && slot.sourceDropdown && slot.sourceDropdown.style.display === 'flex') {
      e.preventDefault();
      const items = Array.from(slot.sourceDropdown.querySelectorAll('.source-dropdown-item'));
      if (items.length > 0) {
        const currentIdx = items.findIndex(el => el.classList.contains('is-focused'));
        items.forEach(el => el.classList.remove('is-focused'));
        const nextIdx = e.key === 'ArrowDown'
          ? (currentIdx + 1) % items.length
          : (currentIdx <= 0 ? items.length - 1 : currentIdx - 1);
        items[nextIdx].classList.add('is-focused');
      }
    }
  });

  // Input changes
  slot.handleInput.addEventListener('input', () => {
    closeSlotSourceDropdown(slot);
    if (slot._probeDebounceTimer) {
      clearTimeout(slot._probeDebounceTimer);
      slot._probeDebounceTimer = null;
    }
    if (!slot.loadedPosts || slot.loadedPosts.length === 0) {
      saveHandles(slots);
    }
    updateClearVisibility();
    updateSlotSourceUI(slot);

    const val = slot.handleInput.value.trim();
    if (isAmbiguousBareHandle(val)) {
      const cleanHandle = val.replace(/^@+/, '');
      slot._probeDebounceTimer = setTimeout(async () => {
        slot._probeDebounceTimer = null;
        if (!slot.handleInput || slot.handleInput.value.trim() !== val || slot.isFetching) return;
        const res = await probeHandlePlatforms(cleanHandle);
        if (!slot.handleInput || slot.handleInput.value.trim() !== val || slot.isFetching) return;
        if (res && res.twitter && res.twitter.exists && res.threads && res.threads.exists) {
          showSlotSourceDropdown(slot, {
            handle: cleanHandle,
            twitter: res.twitter,
            threads: res.threads,
            slots,
            onSelect: (chosenSource) => {
              applyPlatformSelectionAndFetch(slot, chosenSource, res, { slots, onFetch });
            }
          });
        }
      }, 650);
    }
  });
  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && onFetch) {
      e.preventDefault();
      if (slot._probeDebounceTimer) {
        clearTimeout(slot._probeDebounceTimer);
        slot._probeDebounceTimer = null;
      }
      if (slot.sourceDropdown && slot.sourceDropdown.style.display === 'flex') {
        const focusedItem = slot.sourceDropdown.querySelector('.source-dropdown-item.is-focused');
        if (focusedItem) {
          focusedItem.click();
        }
        return;
      }
      const rawVal = slot.handleInput.value.trim();
      onFetch(slot.index, { fromInputSubmit: true });
      if (!isAmbiguousBareHandle(rawVal)) {
        slot.handleInput.blur();
      }
    }
  });
  updateClearVisibility();
  updateSlotSourceUI(slot);

  // Clear handle button inside input box
  slot.btnClear.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSlotSourceDropdown(slot);
    if (slot._probeDebounceTimer) {
      clearTimeout(slot._probeDebounceTimer);
      slot._probeDebounceTimer = null;
    }
    if (slot.loadedPosts && slot.loadedPosts.length > 0 && slot.monitoredHandle) {
      // In edit mode on an active card: only clear the input text so user can type a new handle
      // without wiping already-scraped data.
      archiveSlotScrapedData(slot);
      slot.handleInput.value = '';
      updateClearVisibility();
      updateSlotSourceUI(slot);
      slot.handleInput.focus();
      return;
    }
    clearSlot(slot, { slots });
  });

  // Per-channel system notification mute / unmute toggle button
  if (slot.btnMute) {
    slot.btnMute.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSlotMute(slot, slots);
    });
  }

  // Expand / Size Menu trigger
  slot.btnExpand.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSlotSizeMenu(slot, { slots, getGridDimensions, onResize });
  });
}

function initSlotsRegistry({ slotsCount = MAX_SLOTS, bgWebviewsContainer, onFetch, onResize, getGridDimensions }) {
  const savedHandles = getSavedHandles();
  const savedMuted = getMutedSlots();
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
      unreadBadge: el.querySelector(`#slot-unread-badge-${i}`),
      inputWrapper: el.querySelector(`#slot-input-wrapper-${i}`),
      inputPrefix: el.querySelector(`#slot-input-prefix-${i}`),
      handleInput: el.querySelector(`#handle-input-${i}`),
      btnClear: el.querySelector(`#btn-clear-${i}`),
      sourceDropdown: el.querySelector(`#slot-source-dropdown-${i}`),
      btnMute: el.querySelector(`#btn-mute-${i}`),
      muteIcon: el.querySelector(`#mute-icon-${i}`),
      btnExpand: el.querySelector(`#btn-expand-${i}`),
      expandIcon: el.querySelector(`#expand-icon-${i}`),
      sizeMenu: el.querySelector(`#size-menu-${i}`),
      contentContainer: el.querySelector(`#slot-content-${i}`),
      placeholder: el.querySelector(`#slot-placeholder-${i}`),
      loading: el.querySelector(`#slot-loading-${i}`),
      loadingText: el.querySelector(`#slot-loading-text-${i}`),
      error: el.querySelector(`#slot-error-${i}`),
      postsList: el.querySelector(`#slot-posts-list-${i}`),
      isFetching: false,
      isMuted: typeof savedMuted[i] === 'boolean' ? savedMuted[i] : DEFAULT_SLOT_MUTED,
      loadedPosts: []
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
    const savedSource = detectSourceType(savedHandles[i] || '');
    slot.monitoredHandle = savedHandles[i]
      ? (savedSource === SOURCE_THREADS ? normalizeThreadsHandle(savedHandles[i]) : savedHandles[i])
      : '';
    slot.source = savedSource;
    slot.sourceTitle = '';
    slot.sourceSubtitle = '';
    resetSlotReadTracking(slot);

    updateSlotMuteUI(slot);

    slots.push(slot);
    bindSlotEvents(slot, { slots, onFetch, onResize, getGridDimensions });
  }

  return slots;
}

function loadSlotCache(slots) {
  try {
    const cache = getSlotCache();

    // First, ensure every existing slot cache entry is indexed in per-target cache
    for (const slotKey of Object.keys(cache)) {
      const entry = cache[slotKey];
      const entryPosts = entry && (Array.isArray(entry.posts) ? entry.posts : entry.tweets);
      if (entry && Array.isArray(entryPosts) && entryPosts.length > 0 && entry.handle) {
        saveTargetCacheEntry(entry.handle, entry);
      }
    }

    slots.forEach(slot => {
      const currentInput = slot.handleInput ? slot.handleInput.value.trim() : '';
      let slotEntry = cache[slot.index];

      // If the slot's current input doesn't match its slot-indexed cache (e.g., after handle change or profile import),
      // look up scraped data by target handle/channel key in the per-target cache archive!
      if (currentInput) {
        const currentSource = detectSourceType(currentInput);
        const currentKey = getCanonicalTargetKey(currentInput);
        const cachedKey = slotEntry && slotEntry.handle
          ? getCanonicalTargetKey(slotEntry.handle, slotEntry.source)
          : '';
        if (!slotEntry || cachedKey !== currentKey) {
          const targetEntry = getTargetCacheEntry(currentInput, currentSource);
          const targetPosts = targetEntry && (Array.isArray(targetEntry.posts) ? targetEntry.posts : targetEntry.tweets);
          if (targetEntry && Array.isArray(targetPosts) && targetPosts.length > 0) {
            slotEntry = {
              ...targetEntry,
              posts: targetPosts,
              source: currentSource,
              handle: currentSource === SOURCE_DISCORD
                ? currentInput
                : (currentSource === SOURCE_THREADS
                    ? normalizeThreadsHandle(currentInput)
                    : normalizeTwitterHandle(currentInput)),
              isMuted: slot.isMuted !== false
            };
          } else {
            slotEntry = null;
          }
        }
      } else if (slotEntry && slotEntry.handle) {
        // Slot input was cleared, do not render stale slot cache
        slotEntry = null;
      }

      if (slotEntry) {
        let { handle, avatarUrl, lastFetchedAt, source, sourceTitle, sourceSubtitle } = slotEntry;
        const posts = Array.isArray(slotEntry.posts) ? slotEntry.posts : slotEntry.tweets;

        const resolvedSource = source || detectSourceType(currentInput || handle);
        const isDiscord = resolvedSource === SOURCE_DISCORD;
        const isThreads = resolvedSource === SOURCE_THREADS;
        const cleanHandle = String(handle || '').replace(/^@/, '').toLowerCase().trim();

        // Self-heal corrupted Discord cache where messages belong to a different channel
        if (isDiscord && handle) {
          const slotParsed = parseDiscordChannelUrl(handle);
          if (slotParsed && slotParsed.channelId && Array.isArray(posts) && posts.length > 0) {
            const firstMsgUrl = posts[0].url || '';
            const msgParsed = parseDiscordChannelUrl(firstMsgUrl);
            if (msgParsed && msgParsed.channelId && msgParsed.channelId !== slotParsed.channelId) {
              saveSlotCache(slot.index, null, slots);
              return;
            }
          }
        }

        if (isDiscord) {
          let rawTitle = (slotEntry.displayName && (slotEntry.displayName.includes('\n') || slotEntry.displayName.includes(':')))
            ? slotEntry.displayName
            : (sourceTitle || slotEntry.displayName || '#频道');
          let chan = '';
          let guild = sourceSubtitle || slotEntry.userHandle || '';

          const rawLines = String(rawTitle).split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
          if (rawLines.length >= 2) {
            const l0 = rawLines[0].replace(/^[#@]+/, '').replace(/[:：\s]+$/, '').trim();
            const l1 = rawLines[1].replace(/^[#@]+/, '').replace(/[:：\s]+$/, '').trim();
            if (l1) {
              chan = l1;
              if (!guild || guild === l1) guild = l0;
            }
          }

          if (!chan && (rawTitle.includes(':') || rawTitle.includes('：'))) {
            const cparts = rawTitle.split(/[:：]/);
            const p0 = cparts[0].replace(/^[#@]+/, '').trim();
            const p1 = cparts.slice(1).join(':').replace(/^[#@]+/, '').trim();
            if (p1) {
              chan = p1;
              if (!guild || guild === p1) guild = p0;
            }
          }

          if (!chan) {
            chan = String(rawTitle).split(/[\r\n]+/)[0].replace(/^[#@\s]+/, '').replace(/[:：\s]+$/, '').trim();
          }
          chan = chan.split(/[,，(（]/)[0].trim();

          if (guild) {
            guild = String(guild).split(/[\r\n]+/)[0].replace(/\s*[-|]\s*Discord$/i, '').trim();
            if (guild.toLowerCase() === chan.toLowerCase()) guild = '';
          }

          sourceTitle = chan ? ('#' + chan) : '#频道';
          sourceSubtitle = guild;

          if (slotEntry.sourceTitle !== sourceTitle || slotEntry.sourceSubtitle !== sourceSubtitle || slotEntry.displayName !== sourceTitle) {
            slotEntry.sourceTitle = sourceTitle;
            slotEntry.sourceSubtitle = sourceSubtitle;
            slotEntry.displayName = sourceTitle;
            slotEntry.userHandle = sourceSubtitle;
          }
          if (Array.isArray(posts) && posts.length > 0) {
            posts.forEach(p => {
              if (!p) return;
              if (typeof p.text === 'string') {
                const cleanedText = stripDiscordEditedText(p.text);
                if (cleanedText !== p.text) {
                  p.text = cleanedText;
                }
              }
              if (typeof p.replyText === 'string') {
                const cleanedReply = stripDiscordEditedText(p.replyText);
                if (cleanedReply !== p.replyText) {
                  p.replyText = cleanedReply;
                }
              }
            });
          }
        } else {
          if (slotEntry.displayName) {
            const cleanedDisp = sanitizeSingleLine(slotEntry.displayName);
            if (cleanedDisp !== slotEntry.displayName) {
              slotEntry.displayName = cleanedDisp;
            }
          }
          if (slotEntry.userHandle) {
            const cleanedH = sanitizeSingleLine(slotEntry.userHandle);
            if (cleanedH !== slotEntry.userHandle) {
              slotEntry.userHandle = cleanedH;
            }
          }
          if (Array.isArray(posts) && posts.length > 0) {
            posts.forEach(p => {
              if (p.displayName) {
                const cleanedDisp = sanitizeSingleLine(p.displayName);
                if (cleanedDisp !== p.displayName) {
                  p.displayName = cleanedDisp;
                }
              }
              if (p.userHandle) {
                const cleanedH = sanitizeSingleLine(p.userHandle);
                if (cleanedH !== p.userHandle) {
                  p.userHandle = cleanedH;
                }
              }
            });
          }
        }

        slot.source = isDiscord ? SOURCE_DISCORD : (isThreads ? SOURCE_THREADS : 'twitter');
        slot.sourceTitle = sourceTitle || '';
        slot.sourceSubtitle = sourceSubtitle || '';
        updateSlotSourceUI(slot);
        updateSlotMuteUI(slot);

        // Auto-correct mismatched OpenAI avatars from past bug
        if (!isDiscord && !isThreads && cleanHandle && cleanHandle !== 'openai') {
          if (avatarUrl && (avatarUrl.includes('ztsaR0JW') || avatarUrl.includes('1885410181409820672'))) {
            if (cleanHandle === 'sama') {
              avatarUrl = 'https://pbs.twimg.com/profile_images/2046764873200394240/r7BxVezs_400x400.jpg';
            } else if (cleanHandle === 'karpathy') {
              avatarUrl = 'https://pbs.twimg.com/profile_images/1296667294148382721/9Pr6XrPB_400x400.jpg';
            } else {
              avatarUrl = `https://unavatar.io/x/${cleanHandle}`;
            }
            slotEntry.avatarUrl = avatarUrl;
          }
        }

        if (isThreads && avatarUrl && avatarUrl.includes('unavatar.io')) {
          avatarUrl = '';
          slotEntry.avatarUrl = '';
        }

        if (lastFetchedAt) {
          slot.lastFetchedAt = lastFetchedAt;
          updateSlotFetchTimeUI(slot, lastFetchedAt);
        }
        if (avatarUrl) {
          updateSlotAvatar(slot, avatarUrl);
        } else if (isThreads && cleanHandle) {
          probeHandlePlatforms(cleanHandle, { threadsOnly: true }).then(res => {
            if (res && res.threads && res.threads.avatarUrl) {
              if (slot.source === SOURCE_THREADS && normalizeThreadsHandle(slot.monitoredHandle || '').toLowerCase() === cleanHandle) {
                updateSlotAvatar(slot, res.threads.avatarUrl);
                if (Array.isArray(slot.loadedPosts)) {
                  slot.loadedPosts.forEach(p => {
                    if (!p.avatarUrl || p.avatarUrl.includes('unavatar.io')) {
                      p.avatarUrl = res.threads.avatarUrl;
                    }
                  });
                }
                persistSlot(slot, {
                  handle: slot.monitoredHandle || handle,
                  displayName: slot.authorName ? slot.authorName.innerText : '',
                  userHandle: slot.authorHandle ? slot.authorHandle.innerText : `threads:@${cleanHandle}`,
                  posts: slot.loadedPosts || [],
                  avatarUrl: res.threads.avatarUrl
                }, slots);
              }
            }
          }).catch(() => {});
        }
        if (Array.isArray(posts) && posts.length > 0) {
          posts.forEach(p => {
            if (isThreads && p.avatarUrl && p.avatarUrl.includes('unavatar.io')) {
              p.avatarUrl = avatarUrl || '';
            }
          });
          slot.monitoredHandle = handle;
          resetSlotReadTracking(slot);
          ensureSlotReadTracking(slot, slotEntry);
          const targetArch = getTargetCacheEntry(handle, slot.source);
          if (targetArch) {
            ensureSlotReadTracking(slot, targetArch);
          }
          const sorted = processAndSortPosts(posts);
          recordSlotReadPosts(slot, sorted);
          const meta = isDiscord
            ? { source: SOURCE_DISCORD, title: sourceTitle || '#频道', subtitle: sourceSubtitle || '' }
            : {
                source: isThreads ? SOURCE_THREADS : 'twitter',
                displayName: sanitizeSingleLine(slotEntry.displayName || ''),
                userHandle: sanitizeSingleLine(slotEntry.userHandle || `@${handle}`)
              };
          renderSlotPosts(slot, sorted, handle, avatarUrl, slots, meta);
        }
      }
    });
  } catch (e) {}
}

function markAllPostsAsRead(slots) {
  slots.forEach(slot => {
    markSlotPostsAsRead(slot, slots);
  });
}

function refreshSlotsContent(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(slot => {
    if (slot && Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
      const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
      const avatarUrl = (slot.avatarImg && slot.avatarImg.src) || null;
      const isDiscord = slot.source === SOURCE_DISCORD;
      const isThreads = slot.source === SOURCE_THREADS;
      const meta = isDiscord
        ? { source: SOURCE_DISCORD, title: normalizeDiscordChannelFallback(slot.sourceTitle || t('slot.defaultDiscordChannel')), subtitle: slot.sourceSubtitle || '' }
        : {
            source: isThreads ? SOURCE_THREADS : 'twitter',
            displayName: slot.authorName ? slot.authorName.innerText : '',
            userHandle: slot.authorHandle ? slot.authorHandle.innerText : `@${handle}`
          };
      renderSlotPosts(slot, slot.loadedPosts, handle, avatarUrl, slots, meta);
    }
  });
}

function localizeSlotsUI(slots) {
  if (!Array.isArray(slots)) return;
  closeAllSizeMenus(slots);
  slots.forEach((slot) => {
    if (!slot || !slot.element) return;
    const dragIndicator = slot.element.querySelector('.slot-drag-indicator');
    if (dragIndicator) dragIndicator.title = t('slot.dragHandleTitle');
    if (slot.avatarContainer) slot.avatarContainer.title = t('slot.avatarTitle');
    if (slot.authorHeader) {
      const editHint = slot.authorHeader.querySelector('.slot-author-edit-hint');
      if (editHint) editHint.title = t('slot.editHint');
    }
    if (slot.handleInput) slot.handleInput.placeholder = t('slot.inputPlaceholder');
    if (slot.btnClear) slot.btnClear.title = t('slot.clearBtnTitle');
    if (slot.placeholder) {
      const p = slot.placeholder.querySelector('p');
      if (p) p.textContent = t('slot.placeholderText');
    }
    if (slot.loadingText && !slot.isFetching) {
      slot.loadingText.textContent = t('slot.loadingText');
    }
    updateSlotMuteUI(slot);
    updateSlotUnreadBadge(slot);
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
    const node = slot.element.gridstackNode;
    const w = node ? (node.w || 1) : 1;
    const h = node ? (node.h || 1) : 1;
    updateSlotSizeUI(slot, w, h);
  });
}

module.exports = {
  createSlotWidget,
  updateSlotAvatar,
  updateSlotMuteUI,
  toggleSlotMute,
  updateSlotSourceUI,
  updateSlotFetchTimeUI,
  updateSlotUnreadBadge,
  markSlotPostsAsRead,
  showSlotLoading,
  showSlotError,
  renderSlotPosts,
  persistSlot,
  archiveSlotScrapedData,
  restoreSlotFromTargetCache,
  resetSlotForNewTarget,
  clearSlot,
  slotHasContent,
  updateSlotSizeUI,
  closeSlotSourceDropdown,
  closeAllSourceDropdowns,
  showSlotSourceDropdown,
  applyPlatformSelectionAndFetch,
  closeAllSizeMenus,
  toggleSlotSizeMenu,
  bindSlotEvents,
  initSlotsRegistry,
  loadSlotCache,
  markAllPostsAsRead,
  refreshSlotsContent,
  localizeSlotsUI
};

