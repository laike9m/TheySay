const { shell } = require('electron');
const { MAX_SLOTS, DEFAULT_SLOT_MUTED } = require('./constants');
const { escapeHtml, showToast, formatFetchTime, stripDiscordEditedText } = require('./utils');
const {
  getTweetKey,
  processAndSortTweets,
  getTweetDateKey,
  getTweetDateLabel,
  formatTelegramTime,
  shouldShowTweetPopup,
  isTweetWithQuote,
  isMemberOnlyTweet,
  ensureSlotReadTracking,
  recordSlotReadTweets,
  serializeSlotReadTracking,
  resetSlotReadTracking
} = require('./tweet');
const { openTweetPopup, prefetchTweet } = require('./popup');
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
  getShowMemberOnlyTweets
} = require('./storage');
const { getOrCreateSlotWebview } = require('./webview');
const {
  SOURCE_DISCORD,
  detectSourceType,
  normalizeTwitterHandle,
  parseDiscordChannelUrl,
  getCanonicalTargetKey
} = require('./source');
const { requestNotificationPermission } = require('./notification');
const { formatTextWithTickers } = require('./ticker');
const {
  t,
  translateAttachmentLabel,
  isImageAttachmentLabel,
  normalizeDiscordChannelFallback,
  normalizeMediaOnlyText
} = require('./i18n');

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
            <img class="slot-avatar-img" id="slot-avatar-img-${index}" alt="" style="display: none;">
            <span class="slot-avatar-placeholder" id="slot-avatar-placeholder-${index}">👤</span>
          </div>

          <!-- Identity Area: Displays Author Name / Handle next to Avatar, or Input Field -->
          <div class="slot-identity-area" id="slot-identity-${index}">
            <!-- Author display badge next to avatar (shown when tweets loaded) -->
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

function getSlotSource(slot) {
  if (!slot) return 'twitter';
  if (slot.source) return slot.source;
  return detectSourceType(slot.handleInput ? slot.handleInput.value : '');
}

function isDiscordSlot(slot) {
  return getSlotSource(slot) === SOURCE_DISCORD;
}

function getSlotDisplayLabel(slot) {
  if (!slot) return t('slot.defaultChannelName');
  if (isDiscordSlot(slot)) {
    return normalizeDiscordChannelFallback(
      slot.sourceTitle || (slot.authorName && slot.authorName.innerText) || t('slot.defaultDiscordChannel')
    ).trim();
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

  if (Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0) {
    persistSlot(slot, {
      handle: slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : ''),
      displayName: slot.authorName ? slot.authorName.innerText : '',
      userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
      tweets: slot.loadedTweets,
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
 * Twitter handle reads as "@name", a pasted Discord link as a "#channel".
 */
function updateSlotSourceUI(slot) {
  if (!slot) return;
  const isDiscord = detectSourceType(slot.handleInput ? slot.handleInput.value : '') === SOURCE_DISCORD;

  if (slot.inputPrefix) {
    slot.inputPrefix.innerText = isDiscord ? '#' : '@';
    slot.inputPrefix.classList.toggle('is-discord', isDiscord);
  }
  if (slot.avatarPlaceholder) {
    slot.avatarPlaceholder.innerText = (isDiscord || slot.source === SOURCE_DISCORD) ? '#' : '👤';
  }
  if (slot.card) {
    slot.card.classList.toggle('is-discord', isDiscord || slot.source === SOURCE_DISCORD);
  }
}

/**
 * Single funnel for slot persistence so that the source and the resolved
 * channel / server names are never dropped on the way into localStorage.
 */
function persistSlot(slot, { handle, displayName, userHandle, tweets, avatarUrl }, slots = []) {
  recordSlotReadTweets(slot, tweets);
  saveSlotCache(slot.index, {
    handle,
    displayName,
    userHandle,
    tweets,
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

  if (slot.authorHeader) {
    let name;
    if (isDiscord) {
      const title = normalizeDiscordChannelFallback(slot.sourceTitle || t('slot.defaultDiscordChannel'));
      const subtitle = slot.sourceSubtitle || '';
      name = subtitle ? `${title} · ${subtitle}` : title;
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
  if (!slot || !Array.isArray(slot.loadedTweets) || slot.loadedTweets.length === 0) return 0;
  const isDiscord = isDiscordSlot(slot);
  const showMemberOnly = getShowMemberOnlyTweets();
  const visible = (showMemberOnly || isDiscord)
    ? slot.loadedTweets
    : slot.loadedTweets.filter(t => !isMemberOnlyTweet(t));
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

function markSlotTweetsAsRead(slot, slots = []) {
  if (!slot) return false;
  let updated = false;
  if (Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0) {
    slot.loadedTweets.forEach(t => {
      if (t && t.isUnread) {
        t.isUnread = false;
        updated = true;
      }
    });
    recordSlotReadTweets(slot, slot.loadedTweets);
  }
  if (slot.tweetsList) {
    const unreadBubbles = slot.tweetsList.querySelectorAll('.im-bubble.unread');
    if (unreadBubbles.length > 0) {
      unreadBubbles.forEach(b => b.classList.remove('unread'));
      updated = true;
    }
  }
  if (updated && Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0) {
    persistSlot(slot, {
      handle: slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : ''),
      displayName: slot.authorName ? slot.authorName.innerText : '',
      userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
      tweets: slot.loadedTweets,
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
  slot.tweetsList.style.display = 'none';
}

function showSlotError(slot, errorMsg) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'block';
  slot.error.innerHTML = `⚠️ ${errorMsg}`;
  slot.tweetsList.style.display = 'none';
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

function buildDiscordBubbleHtml(msg, { showAuthor }) {
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

  if (rawText) {
    html += isLong
      ? `<span class="im-text-content"><span class="im-text-preview">${formatTextWithTickers(previewText, rawText)}<span class="im-text-ellipsis">...</span></span></span>`
      : `<span class="im-text-content">${formatTextWithTickers(rawText)}</span>`;
  }

  const images = Array.isArray(msg.images) ? msg.images.filter(Boolean) : [];
  if (images.length > 0) {
    const gridClass = images.length > 1 ? 'multi' : 'single';
    html += `<div class="im-media-grid ${gridClass}">`;
    images.forEach(imgUrl => {
      html += `<img class="im-media-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(t('slot.imageAlt'))}" loading="lazy" referrerpolicy="no-referrer">`;
    });
    html += '</div>';
  }

  const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const visibleAttachments = images.length > 0
    ? rawAttachments.filter(a => !isImageAttachmentLabel(a))
    : rawAttachments;

  if (visibleAttachments.length > 0) {
    html += '<span class="im-attachments">';
    visibleAttachments.forEach(a => {
      html += `<span class="im-attachment-chip">${escapeHtml(translateAttachmentLabel(a))}</span>`;
    });
    html += '</span>';
  }

  return html;
}

function buildTweetBubbleHtml(tweet) {
  const rawText = normalizeMediaOnlyText((tweet.text || '').trim());
  const chars = Array.from(rawText);
  const isLong = chars.length > 100;
  const previewText = isLong ? chars.slice(0, 100).join('') : rawText;

  let tagHtml = '';
  if (tweet.isPinned) tagHtml += `<span class="tweet-tag">${escapeHtml(t('slot.tagPinned'))}</span>`;
  if (tweet.isRetweet) tagHtml += `<span class="tweet-tag repost">${escapeHtml(t('slot.tagRepost'))}</span>`;
  if (isTweetWithQuote(tweet)) tagHtml += `<span class="tweet-tag quote">${escapeHtml(t('slot.tagQuote'))}</span>`;
  if (isMemberOnlyTweet(tweet)) tagHtml += `<span class="tweet-tag member" title="${escapeHtml(t('slot.tagMemberOnlyTitle'))}">${escapeHtml(t('slot.tagMemberOnly'))}</span>`;

  const textHtml = isLong
    ? `<span class="im-text-content"><span class="im-text-preview">${formatTextWithTickers(previewText, rawText)}<span class="im-text-ellipsis">...</span></span></span>`
    : `<span class="im-text-content">${formatTextWithTickers(rawText)}</span>`;

  return `${tagHtml}${textHtml}`;
}

/**
 * Renders a slot's feed.
 *
 * `meta` is only supplied by non-Twitter sources; when it is omitted the header
 * keeps deriving its identity from the first tweet, exactly as before.
 */
function renderSlotTweets(slot, tweets, handle, avatarUrl = null, slots = [], meta = null) {
  slot.placeholder.style.display = 'none';
  slot.loading.style.display = 'none';
  slot.error.style.display = 'none';
  slot.tweetsList.style.display = 'flex';

  ensureSlotReadTracking(slot);
  recordSlotReadTweets(slot, tweets);
  slot.loadedTweets = tweets;

  const isDiscord = !!(meta && meta.source === SOURCE_DISCORD);
  slot.source = isDiscord ? SOURCE_DISCORD : 'twitter';

  const firstTweet = tweets[0] || {};

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
      for (const t of tweets) {
        if (t.displayName) {
          const cleaned = sanitizeSingleLine(t.displayName);
          if (cleaned && cleaned.toLowerCase() !== handle.toLowerCase()) {
            rawName = cleaned;
            break;
          }
        }
      }
    }

    if (!rawName && firstTweet.displayName) {
      rawName = sanitizeSingleLine(firstTweet.displayName);
    }

    if (!rawHandle) {
      for (const t of tweets) {
        if (t.userHandle) {
          const cleanedH = sanitizeSingleLine(t.userHandle);
          if (cleanedH) {
            rawHandle = cleanedH;
            break;
          }
        }
      }
    }

    if (!rawHandle) {
      rawHandle = sanitizeSingleLine(firstTweet.userHandle || `@${handle}`);
    }
    if (!rawHandle.startsWith('@') && rawHandle) rawHandle = `@${rawHandle}`;

    const bareHandle = rawHandle.replace(/^@/, '').toLowerCase();
    const bareName = rawName.replace(/^@/, '').toLowerCase();

    slot.sourceTitle = '';
    slot.sourceSubtitle = '';

    // Set author name next to avatar
    if (rawName && bareName !== bareHandle) {
      displayName = rawName;
      userHandle = rawHandle;
      slot.authorName.innerText = displayName;
      slot.authorHandle.innerText = userHandle;
    } else {
      displayName = rawHandle || `@${handle}`;
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

  slot.tweetsList.innerHTML = '';

  const finalAvatar = avatarUrl || (slot.avatarImg && slot.avatarImg.src) || '';

  const markBubbleAsRead = (tweetObj, bubbleEl) => {
    let changed = false;
    if (bubbleEl && bubbleEl.classList.contains('unread')) {
      bubbleEl.classList.remove('unread');
      changed = true;
    }
    if (tweetObj && tweetObj.isUnread) {
      tweetObj.isUnread = false;
      changed = true;
    }
    const targetKey = getTweetKey(tweetObj);
    if (targetKey && Array.isArray(slot.loadedTweets)) {
      slot.loadedTweets.forEach(t => {
        if (t && getTweetKey(t) === targetKey && t.isUnread) {
          t.isUnread = false;
          changed = true;
        }
      });
    }
    if (changed) {
      recordSlotReadTweets(slot, slot.loadedTweets);
      updateSlotUnreadBadge(slot);
      persistSlot(slot, { handle, displayName, userHandle, tweets: slot.loadedTweets, avatarUrl: finalAvatar }, slots);
    }
  };

  const showMemberOnly = getShowMemberOnlyTweets();
  const displayTweets = (showMemberOnly || isDiscord)
    ? tweets
    : tweets.filter(t => !isMemberOnlyTweet(t));

  let lastDateKey = null;
  let lastAuthorName = null;

  displayTweets.forEach((tweet) => {
    const dateKey = getTweetDateKey(tweet);
    const dateLabel = getTweetDateLabel(tweet);
    let startedNewDay = false;

    if (dateKey && dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      startedNewDay = true;
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
    if (isMemberOnlyTweet(tweet)) {
      bubble.classList.add('is-member-only');
    }

    // Restore to normal bubble color once hovered or clicked
    bubble.addEventListener('mouseenter', () => {
      markBubbleAsRead(tweet, bubble);
    });

    // Store avatar reference on tweet object if available
    if (!tweet.avatarUrl && finalAvatar) {
      tweet.avatarUrl = finalAvatar;
    }

    const timeDisplay = formatTelegramTime(tweet);
    const linkTitle = isDiscord ? t('slot.openOriginalDiscord') : t('slot.openOriginalTweet');

    let bodyHtml;
    if (isDiscord) {
      // Consecutive messages from the same person collapse into one visual
      // group, the way every chat client renders them.
      const showAuthor = startedNewDay || tweet.displayName !== lastAuthorName;
      bodyHtml = buildDiscordBubbleHtml(tweet, { showAuthor });
      bubble.classList.add('discord');
      if (!showAuthor) bubble.classList.add('grouped');
      lastAuthorName = tweet.displayName;
    } else {
      bodyHtml = buildTweetBubbleHtml(tweet);
    }

    bubble.innerHTML = `${bodyHtml}<span class="im-time">${escapeHtml(timeDisplay)}</span>${tweet.url ? `<a class="im-btn-link" data-url="${escapeHtml(tweet.url)}" title="${escapeHtml(linkTitle)}">↗</a>` : ''}`;

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
          const grid = imgEl.closest('.im-media-grid');
          if (grid && !Array.from(grid.querySelectorAll('.im-media-img')).some(el => el.style.display !== 'none')) {
            grid.style.display = 'none';
          }
        });
      });
    }

    // Open external tweet link (hover button in top-right)
    if (tweet.url) {
      const linkBtn = bubble.querySelector('.im-btn-link');
      if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          markBubbleAsRead(tweet, bubble);
          shell.openExternal(tweet.url);
        });
      }
    }

    // Click on bubble to open centered popup (click-to-open, no hover trigger)
    const hasPopup = shouldShowTweetPopup(tweet);
    if (hasPopup) {
      bubble.classList.add('has-popup');
      if (!isDiscord) {
        // Hovering is a strong hint the user is about to click, so jump this
        // tweet to the front of the embed render queue. Discord messages are
        // rendered locally and need no warm-up.
        bubble.addEventListener('mouseenter', () => {
          prefetchTweet(tweet, { priority: true });
        });
      }
      bubble.addEventListener('click', (e) => {
        if (e.target.closest('.im-btn-link')) return;
        markBubbleAsRead(tweet, bubble);
        openTweetPopup(tweet);
      });
    } else {
      bubble.addEventListener('click', () => {
        markBubbleAsRead(tweet, bubble);
      });
    }

    slot.tweetsList.appendChild(bubble);
  });

  if (displayTweets.length === 0 && tweets.length > 0 && !isDiscord) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'im-filtered-empty-notice';
    emptyNotice.innerText = t('slot.hiddenMemberTweets', { count: tweets.length });
    slot.tweetsList.appendChild(emptyNotice);
  }

  // Auto-scroll to bottom to show the latest messages (Telegram style)
  requestAnimationFrame(() => {
    if (slot.contentContainer) {
      slot.contentContainer.scrollTop = slot.contentContainer.scrollHeight;
    }
  });

  persistSlot(slot, { handle, displayName, userHandle, tweets, avatarUrl: finalAvatar }, slots);

  // Background idle prefetch for tweets eligible for popups.
  // The list auto-scrolls to the bottom, so the newest tweets are the ones on
  // screen and the most likely to be clicked.
  if (!isDiscord && Array.isArray(tweets) && tweets.length > 0) {
    const popTweets = tweets.filter(shouldShowTweetPopup);
    if (popTweets.length > 0) {
      setTimeout(() => {
        popTweets.slice(-4).reverse().forEach((t) => prefetchTweet(t));
      }, 1000);
    }
  }
}


function archiveSlotScrapedData(slot) {
  if (!slot || !Array.isArray(slot.loadedTweets) || slot.loadedTweets.length === 0) return;
  const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
  if (!handle) return;
  recordSlotReadTweets(slot, slot.loadedTweets);
  saveTargetCacheEntry(handle, {
    handle,
    displayName: slot.authorName ? slot.authorName.innerText : '',
    userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
    tweets: slot.loadedTweets,
    avatarUrl: (slot.avatarImg && slot.avatarImg.src) || '',
    isMuted: slot.isMuted !== false,
    source: slot.source || detectSourceType(handle),
    sourceTitle: slot.sourceTitle || '',
    sourceSubtitle: slot.sourceSubtitle || '',
    lastFetchedAt: slot.lastFetchedAt || Date.now(),
    ...serializeSlotReadTracking(slot)
  });
}

function restoreSlotFromTargetCache(slot, rawInput, slots = []) {
  if (!slot) return false;
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return false;

  const isDiscord = detectSourceType(trimmed) === SOURCE_DISCORD;
  const cached = getTargetCacheEntry(trimmed, isDiscord ? SOURCE_DISCORD : 'twitter');
  if (!cached || !Array.isArray(cached.tweets) || cached.tweets.length === 0) {
    return false;
  }

  const targetHandle = isDiscord ? trimmed : normalizeTwitterHandle(trimmed);
  resetSlotReadTracking(slot);
  ensureSlotReadTracking(slot, cached);
  slot.source = isDiscord ? SOURCE_DISCORD : 'twitter';
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

  const sorted = processAndSortTweets(cached.tweets);
  recordSlotReadTweets(slot, sorted);
  const meta = isDiscord
    ? {
        source: SOURCE_DISCORD,
        title: cached.sourceTitle || cached.displayName || '#频道',
        subtitle: cached.sourceSubtitle || cached.userHandle || ''
      }
    : {
        source: 'twitter',
        displayName: sanitizeSingleLine(cached.displayName || ''),
        userHandle: sanitizeSingleLine(cached.userHandle || `@${targetHandle}`)
      };

  renderSlotTweets(slot, sorted, targetHandle, cached.avatarUrl || null, slots, meta);
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
  slot.loadedTweets = [];
  slot.monitoredHandle = trimmed
    ? (detectSourceType(trimmed) === SOURCE_DISCORD ? trimmed : normalizeTwitterHandle(trimmed))
    : '';
  slot.source = detectSourceType(trimmed);
  slot.sourceTitle = '';
  slot.sourceSubtitle = '';
  slot.lastFetchedAt = null;
  slot.tweetsList.innerHTML = '';
  slot.tweetsList.style.display = 'none';
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
  slot.loadedTweets = [];
  slot.monitoredHandle = '';
  slot.source = '';
  slot.sourceTitle = '';
  slot.sourceSubtitle = '';
  slot.tweetsList.innerHTML = '';
  slot.tweetsList.style.display = 'none';
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
    slot.btnExpand.title = t('slot.currentSizeTitle', { r, c });
  } else {
    slot.card.classList.remove('is-priority');
    slot.btnExpand.classList.remove('expanded');
    slot.expandIcon.innerHTML = `<svg class="expand-svg" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="3" y2="21"></line></svg>`;
    slot.btnExpand.title = t('slot.resizeCardTitle');
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
      markSlotTweetsAsRead(slot, slots);
    });
  }

  // When handleInput loses focus or escape is pressed, revert to author badge if tweets exist for same handle (or if left empty)
  slot.handleInput.addEventListener('blur', () => {
    const val = slot.handleInput.value.trim();
    const monitored = (slot.monitoredHandle || '').trim();
    const isSameOrEmpty = !val || (monitored && getCanonicalTargetKey(val) === getCanonicalTargetKey(monitored));
    if (isSameOrEmpty && slot.loadedTweets && slot.loadedTweets.length > 0 && slot.authorName.innerText.trim()) {
      if (!val && monitored) {
        slot.handleInput.value = monitored;
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
      if (slot.loadedTweets && slot.loadedTweets.length > 0 && slot.authorName.innerText.trim()) {
        if (slot.monitoredHandle) {
          slot.handleInput.value = slot.monitoredHandle;
          saveHandles(slots);
          updateClearVisibility();
          updateSlotSourceUI(slot);
        }
        slot.authorHeader.style.display = 'flex';
        slot.inputWrapper.style.display = 'none';
        updateSlotUnreadBadge(slot);
      }
    }
  });

  // Input changes
  slot.handleInput.addEventListener('input', () => {
    if (!slot.loadedTweets || slot.loadedTweets.length === 0) {
      saveHandles(slots);
    }
    updateClearVisibility();
    updateSlotSourceUI(slot);
  });
  slot.handleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && onFetch) {
      e.preventDefault();
      onFetch(slot.index);
      slot.handleInput.blur();
    }
  });
  updateClearVisibility();
  updateSlotSourceUI(slot);

  // Clear handle button inside input box
  slot.btnClear.addEventListener('click', (e) => {
    e.stopPropagation();
    if (slot.loadedTweets && slot.loadedTweets.length > 0 && slot.monitoredHandle) {
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
      tweetsList: el.querySelector(`#slot-tweets-list-${i}`),
      isFetching: false,
      isMuted: typeof savedMuted[i] === 'boolean' ? savedMuted[i] : DEFAULT_SLOT_MUTED,
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
      slot.source = detectSourceType(savedHandles[i] || '');
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
        if (entry && Array.isArray(entry.tweets) && entry.tweets.length > 0 && entry.handle) {
          saveTargetCacheEntry(entry.handle, entry);
        }
      }

      slots.forEach(slot => {
        const currentInput = slot.handleInput ? slot.handleInput.value.trim() : '';
        let slotEntry = cache[slot.index];

        // If the slot's current input doesn't match its slot-indexed cache (e.g., after handle change or profile import),
        // look up scraped data by target handle/channel key in the per-target cache archive!
        if (currentInput) {
          const currentKey = getCanonicalTargetKey(currentInput);
          const cachedKey = slotEntry && slotEntry.handle
            ? getCanonicalTargetKey(slotEntry.handle, slotEntry.source)
            : '';
          if (!slotEntry || cachedKey !== currentKey) {
            const targetEntry = getTargetCacheEntry(currentInput);
            if (targetEntry && Array.isArray(targetEntry.tweets) && targetEntry.tweets.length > 0) {
              slotEntry = {
                ...targetEntry,
                handle: detectSourceType(currentInput) === SOURCE_DISCORD
                  ? currentInput
                  : normalizeTwitterHandle(currentInput),
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
          let { tweets, handle, avatarUrl, lastFetchedAt, source, sourceTitle, sourceSubtitle } = slotEntry;

          const isDiscord = (source || detectSourceType(handle)) === SOURCE_DISCORD;
          const cleanHandle = String(handle || '').replace(/^@/, '').toLowerCase().trim();

          // Self-heal corrupted Discord cache where messages belong to a different channel
          if (isDiscord && handle) {
            const slotParsed = parseDiscordChannelUrl(handle);
            if (slotParsed && slotParsed.channelId && Array.isArray(tweets) && tweets.length > 0) {
              const firstMsgUrl = tweets[0].url || '';
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
            if (Array.isArray(tweets) && tweets.length > 0) {
              tweets.forEach(t => {
                if (!t) return;
                if (typeof t.text === 'string') {
                  const cleanedText = stripDiscordEditedText(t.text);
                  if (cleanedText !== t.text) {
                    t.text = cleanedText;
                  }
                }
                if (typeof t.replyText === 'string') {
                  const cleanedReply = stripDiscordEditedText(t.replyText);
                  if (cleanedReply !== t.replyText) {
                    t.replyText = cleanedReply;
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
            if (Array.isArray(tweets) && tweets.length > 0) {
              tweets.forEach(t => {
                if (t.displayName) {
                  const cleanedDisp = sanitizeSingleLine(t.displayName);
                  if (cleanedDisp !== t.displayName) {
                    t.displayName = cleanedDisp;
                  }
                }
                if (t.userHandle) {
                  const cleanedH = sanitizeSingleLine(t.userHandle);
                  if (cleanedH !== t.userHandle) {
                    t.userHandle = cleanedH;
                  }
                }
              });
            }
          }

          slot.source = isDiscord ? SOURCE_DISCORD : 'twitter';
          slot.sourceTitle = sourceTitle || '';
          slot.sourceSubtitle = sourceSubtitle || '';
          updateSlotSourceUI(slot);
          updateSlotMuteUI(slot);

          // Auto-correct mismatched OpenAI avatars from past bug
          if (!isDiscord && cleanHandle && cleanHandle !== 'openai') {
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

          if (lastFetchedAt) {
            slot.lastFetchedAt = lastFetchedAt;
            updateSlotFetchTimeUI(slot, lastFetchedAt);
          }
          if (avatarUrl) {
            updateSlotAvatar(slot, avatarUrl);
          }
          if (Array.isArray(tweets) && tweets.length > 0) {
            tweets.forEach(t => {
              if (t.id === '1900000000000000099' || (t.url && t.url.includes('1900000000000000099'))) {
                t.hasQuote = true;
              }
            });
            slot.monitoredHandle = handle;
            resetSlotReadTracking(slot);
            ensureSlotReadTracking(slot, slotEntry);
            const targetArch = getTargetCacheEntry(handle, slot.source);
            if (targetArch) {
              ensureSlotReadTracking(slot, targetArch);
            }
            const sorted = processAndSortTweets(tweets);
            recordSlotReadTweets(slot, sorted);
            const meta = isDiscord
              ? { source: SOURCE_DISCORD, title: sourceTitle || '#频道', subtitle: sourceSubtitle || '' }
              : {
                  source: 'twitter',
                  displayName: sanitizeSingleLine(slotEntry.displayName || ''),
                  userHandle: sanitizeSingleLine(slotEntry.userHandle || `@${handle}`)
                };
            renderSlotTweets(slot, sorted, handle, avatarUrl, slots, meta);
          }
        }
      });
    } catch (e) {}
  }

function markAllTweetsAsRead(slots) {
  slots.forEach(slot => {
    markSlotTweetsAsRead(slot, slots);
  });
}

function refreshSlotsContent(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(slot => {
    if (slot && Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0) {
      const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
      const avatarUrl = (slot.avatarImg && slot.avatarImg.src) || null;
      const isDiscord = slot.source === SOURCE_DISCORD;
      const meta = isDiscord
        ? { source: SOURCE_DISCORD, title: normalizeDiscordChannelFallback(slot.sourceTitle || t('slot.defaultDiscordChannel')), subtitle: slot.sourceSubtitle || '' }
        : {
            source: 'twitter',
            displayName: slot.authorName ? slot.authorName.innerText : '',
            userHandle: slot.authorHandle ? slot.authorHandle.innerText : `@${handle}`
          };
      renderSlotTweets(slot, slot.loadedTweets, handle, avatarUrl, slots, meta);
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
  markSlotTweetsAsRead,
  showSlotLoading,
  showSlotError,
  renderSlotTweets,
  persistSlot,
  archiveSlotScrapedData,
  restoreSlotFromTargetCache,
  resetSlotForNewTarget,
  clearSlot,
  slotHasContent,
  updateSlotSizeUI,
  closeAllSizeMenus,
  toggleSlotSizeMenu,
  bindSlotEvents,
  initSlotsRegistry,
  loadSlotCache,
  markAllTweetsAsRead,
  refreshSlotsContent,
  localizeSlotsUI
};

