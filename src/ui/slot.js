const { shell, ipcRenderer } = require('electron');
const pLimit = require('p-limit');
const { MAX_SLOTS, DEFAULT_SLOT_MUTED } = require('../core/constants');
const { escapeHtml, showToast, formatFetchTime, stripDiscordEditedText } = require('../core/utils');
const {
  getPostId,
  getPostKey,
  cleanInlineEntityNewlines,
  stripEmptyLines,
  processAndSortPosts,
  getPostDateKey,
  getPostDateLabel,
  formatTelegramTime,
  getPostMinuteKey,
  hasChineseText,
  joinSameMinuteTexts,
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
  getShowMemberOnlyPosts,
  getAppBadgeEnabled
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
const {
  formatTextWithTickers,
  registerUrlTitlesMap,
  extractUrlsFromText,
  replaceUrlsWithTitles,
  sliceTextWithUrlTitles,
  fetchUrlTitle
} = require('../core/ticker');
const { isPlatformLoginExpired, openPlatformLoginWindow } = require('./auth');
const {
  t,
  translateAttachmentLabel,
  isImageAttachmentLabel,
  normalizeDiscordChannelFallback,
  normalizeMediaOnlyText
} = require('../core/i18n');
const {
  mountMantineSlotCard,
  renderMantineMuteIcon,
  renderMantineExpandIcon,
  renderMantineSlotSourceDropdown,
  clearMantineSlotSourceDropdown,
  renderMantineSlotSizeMenu,
  renderMantineSlotPosts,
  clearMantineSlotPosts
} = require('./dist/mantine-shell');

function createSlotWidget(index) {
  const widget = document.createElement('div');
  widget.className = 'grid-stack-item';
  widget.setAttribute('gs-id', `slot-${index}`);
  widget.setAttribute('data-slot-index', index);

  const itemContent = document.createElement('div');
  itemContent.className = 'grid-stack-item-content';
  widget.appendChild(itemContent);

  mountMantineSlotCard(itemContent, index, {
    dragHandleTitle: t('slot.dragHandleTitle'),
    avatarTitle: t('slot.avatarTitle'),
    clickEditAccount: t('slot.clickEditAccount'),
    editHint: t('slot.editHint'),
    inputPlaceholder: t('slot.inputPlaceholder'),
    clearBtnTitle: t('slot.clearBtnTitle'),
    mutedTitle: t('slot.mutedTitle'),
    muteAriaLabel: t('slot.muteAriaLabel'),
    expandBtnTitle: t('slot.expandBtnTitle'),
    placeholderText: t('slot.placeholderText'),
    loadingText: t('slot.loadingText')
  });

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
    renderMantineMuteIcon(slot.muteIcon, isMuted);
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
  updateSlotExpiredUI(slot);
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

function updateSlotHeaderMeta(slot, meta = {}) {
  if (!slot || !meta) return;
  if (meta.source === SOURCE_DISCORD || isDiscordSlot(slot)) {
    let rawTitle = meta.title ? meta.title : (slot.sourceTitle || t('slot.defaultDiscordChannel'));
    if (rawTitle === '#频道' || rawTitle === '#channel') {
      rawTitle = '';
    }
    const rawSubtitle = meta.subtitle !== undefined ? meta.subtitle : (slot.sourceSubtitle || '');
    let cleanChan = sanitizeSingleLine(rawTitle)
      .replace(/^[#@\s]+/, '')
      .replace(/[:：\s]+$/, '')
      .split(/[,，(（]/)[0]
      .trim();
    let cleanGuild = sanitizeSingleLine(rawSubtitle)
      .replace(/\s*[-|]\s*Discord$/i, '')
      .trim();
    if (cleanGuild && cleanChan && cleanGuild.toLowerCase() === cleanChan.toLowerCase()) {
      cleanGuild = '';
    }
    const displayName = cleanChan ? `#${cleanChan}` : t('slot.defaultDiscordChannel');
    slot.sourceTitle = displayName;
    slot.sourceSubtitle = cleanGuild;
    if (slot.authorName) slot.authorName.innerText = displayName;
    if (slot.authorHandle) slot.authorHandle.innerText = cleanGuild;
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
}

function updateSlotExpiredUI(slot) {
  if (!slot || !slot.expiredBanner) return;
  const rawInput = slot.handleInput ? slot.handleInput.value.trim() : '';
  const hasTarget = Boolean(slot.monitoredHandle || rawInput);
  const platform = getSlotSource(slot);
  const expired = hasTarget && isPlatformLoginExpired(platform);

  if (expired) {
    const platformLabel = platform === SOURCE_DISCORD
      ? 'Discord'
      : (platform === SOURCE_THREADS ? 'Threads' : 'Twitter / X');
    if (slot.expiredText) {
      slot.expiredText.textContent = t('auth.slotExpiredBannerText', { platform: platformLabel });
    }
    if (slot.expiredBtn) {
      slot.expiredBtn.textContent = t('auth.slotExpiredLoginBtn');
    }
    slot.expiredBanner.style.display = 'flex';
    if (slot.card) {
      slot.card.classList.add('is-login-expired');
    }
  } else {
    slot.expiredBanner.style.display = 'none';
    if (slot.card) {
      slot.card.classList.remove('is-login-expired');
    }
  }
}

function updateAllSlotsExpiredUI(slots = []) {
  if (!Array.isArray(slots)) return;
  slots.forEach((slot) => {
    updateSlotExpiredUI(slot);
  });
}

let registeredSlots = [];

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

function syncAppUnreadBadge(slots = registeredSlots) {
  const list = Array.isArray(slots) && slots.length > 0 ? slots : registeredSlots;
  if (Array.isArray(slots) && slots.length > 1) {
    registeredSlots = slots;
  }
  const hasAttachedSlots = list.some(s => s && s.element && s.element.parentElement);
  let totalUnread = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s) continue;
    if (hasAttachedSlots && (!s.element || !s.element.parentElement)) continue;
    totalUnread += getSlotUnreadCount(s);
  }
  const effectiveBadgeCount = getAppBadgeEnabled() ? totalUnread : 0;
  if (ipcRenderer && typeof ipcRenderer.send === 'function') {
    ipcRenderer.send('set-app-badge', effectiveBadgeCount);
  }
  return effectiveBadgeCount;
}

function updateSlotUnreadBadge(slot, slots = registeredSlots) {
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
  const targetSlots = Array.isArray(slots) && slots.length > 0 ? slots : (registeredSlots.length > 0 ? registeredSlots : [slot]);
  syncAppUnreadBadge(targetSlots);
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
  updateSlotUnreadBadge(slot, slots);
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
  updateSlotExpiredUI(slot);
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

const BASE_PREVIEW_CHARS = 100;

function trimIncompleteTrailingToken(sliceStr, fullStr) {
  if (sliceStr.length >= fullStr.length) return sliceStr;
  const nextChar = fullStr[sliceStr.length];
  if (!nextChar || /\s/.test(nextChar)) return sliceStr;
  const m = sliceStr.match(/([$@#]?[A-Za-z0-9_.-]+)$/);
  if (!m) return sliceStr;
  const partialToken = m[1];
  const beforeToken = sliceStr.slice(0, sliceStr.length - partialToken.length);
  const lastNewlineIdx = beforeToken.lastIndexOf('\n');
  const lineContentBefore = beforeToken.slice(lastNewlineIdx + 1).trim();
  if (lineContentBefore.length > 0 && partialToken.length <= 15) {
    return beforeToken.trimEnd();
  }
  return sliceStr;
}

function renderTruncatedTextHtml(previewSlice, fullText, linkTitles = null) {
  return `<span class="im-text-preview">${formatTextWithTickers(previewSlice, fullText, { linkTitles })}<span class="im-text-ellipsis">...</span></span>`;
}

function expandBubbleLastLine(bubble) {
  if (!bubble) return;
  const textContentEl = bubble.querySelector('.im-text-content[data-full-text]');
  if (!textContentEl) return;
  const effectiveText = textContentEl.getAttribute('data-full-text') || '';
  const linkTitles = (bubble._post && bubble._post.linkTitles) || null;
  const displayText = replaceUrlsWithTitles(effectiveText, linkTitles);
  const chars = Array.from(displayText);
  if (chars.length <= BASE_PREVIEW_CHARS) {
    textContentEl.innerHTML = formatTextWithTickers(effectiveText, effectiveText, { linkTitles });
    textContentEl.removeAttribute('data-full-text');
    return;
  }

  const measureEl = bubble.querySelector('.im-bubble-left') || bubble;
  const baseBoxHeight = measureEl.getBoundingClientRect().height;
  const baseTextHeight = textContentEl.getBoundingClientRect().height;
  if (!baseBoxHeight || baseBoxHeight <= 0) return;

  const fitsOnSameLastLine = () => {
    const boxH = measureEl.getBoundingClientRect().height;
    const textH = textContentEl.getBoundingClientRect().height;
    return boxH <= baseBoxHeight + 4 && textH <= baseTextHeight + 4;
  };

  let maxLineIdx = BASE_PREVIEW_CHARS;
  if (chars[BASE_PREVIEW_CHARS - 1] === '\n' || chars[BASE_PREVIEW_CHARS - 1] === '\r') {
    maxLineIdx = BASE_PREVIEW_CHARS - 1;
  } else {
    while (maxLineIdx < chars.length && chars[maxLineIdx] !== '\n' && chars[maxLineIdx] !== '\r') {
      maxLineIdx++;
    }
  }

  // If there are no more newlines after BASE_PREVIEW_CHARS, check if the entire remaining
  // text fits on this last line without needing an ellipsis at all.
  if (maxLineIdx === chars.length) {
    textContentEl.innerHTML = formatTextWithTickers(effectiveText, effectiveText, { linkTitles });
    if (fitsOnSameLastLine()) {
      return;
    }
  }

  let low = BASE_PREVIEW_CHARS;
  let high = maxLineIdx;
  let bestK = BASE_PREVIEW_CHARS;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const { slicedText, linkTitles: slicedTitles } = sliceTextWithUrlTitles(effectiveText, mid, linkTitles);
    textContentEl.innerHTML = renderTruncatedTextHtml(slicedText.trimEnd(), effectiveText, slicedTitles);
    if (fitsOnSameLastLine()) {
      bestK = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const { slicedText: rawSlice, linkTitles: bestSlicedTitles } = sliceTextWithUrlTitles(effectiveText, bestK, linkTitles);
  const cleanSlice = trimIncompleteTrailingToken(rawSlice, effectiveText).trimEnd();
  textContentEl.innerHTML = renderTruncatedTextHtml(cleanSlice, effectiveText, bestSlicedTitles);
}

function extractCleanPostText(post, { isDiscord = false } = {}) {
  if (!post) return '';
  let text = post.text || '';
  if (isDiscord) {
    text = stripDiscordEditedText(text);
  } else if (typeof text === 'string' && text.includes('\n')) {
    text = cleanInlineEntityNewlines(text);
  }
  const rawText = stripEmptyLines(normalizeMediaOnlyText(String(text).trim()));
  if (!rawText || rawText === t('scraper.mediaOnlyFallback')) {
    return '';
  }
  return rawText;
}

function canMergeSameMinutePosts(prev, curr, { isDiscord = false } = {}) {
  if (!prev || !curr) return false;
  const prevMinKey = getPostMinuteKey(prev);
  const currMinKey = getPostMinuteKey(curr);
  if (!prevMinKey || !currMinKey || prevMinKey !== currMinKey) return false;

  const prevDateKey = getPostDateKey(prev);
  const currDateKey = getPostDateKey(curr);
  if (prevDateKey !== currDateKey) return false;

  if (Boolean(prev.isPinned) !== Boolean(curr.isPinned)) return false;
  if (Boolean(isMemberOnlyPost(prev)) !== Boolean(isMemberOnlyPost(curr))) return false;

  if (isDiscord) {
    if ((prev.displayName || '') !== (curr.displayName || '')) return false;
    if (Boolean(prev.isBot) !== Boolean(curr.isBot)) return false;
  }

  return true;
}

function groupSameMinutePosts(posts, { isDiscord = false } = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  const groups = [];
  for (const post of posts) {
    if (!post) continue;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && canMergeSameMinutePosts(lastGroup[lastGroup.length - 1], post, { isDiscord })) {
      lastGroup.push(post);
    } else {
      groups.push([post]);
    }
  }

  return groups.map((group) => {
    if (group.length === 1) {
      if (group[0] && group[0].linkTitles) {
        registerUrlTitlesMap(group[0].linkTitles, { persist: false });
      }
      return group[0];
    }

    const basePost = group[0];
    const mergedLinkTitles = {};
    for (const p of group) {
      if (p && p.linkTitles && typeof p.linkTitles === 'object') {
        Object.assign(mergedLinkTitles, p.linkTitles);
      }
    }
    registerUrlTitlesMap(mergedLinkTitles, { persist: false });

    const cleanSegments = group
      .map(p => extractCleanPostText(p, { isDiscord }))
      .filter(Boolean);
    const forceChinese = cleanSegments.some(s => hasChineseText(replaceUrlsWithTitles(s, mergedLinkTitles)));
    const mergedText = joinSameMinuteTexts(cleanSegments, { forceChinese });

    const mergedImages = [];
    const seenImages = new Set();
    const mergedAttachments = [];
    const seenAttachments = new Set();
    let firstReplyPost = null;
    let firstQuotePost = null;

    for (const p of group) {
      if (Array.isArray(p.images)) {
        for (const img of p.images) {
          if (img && !seenImages.has(img)) {
            seenImages.add(img);
            mergedImages.push(img);
          }
        }
      }
      if (Array.isArray(p.attachments)) {
        for (const att of p.attachments) {
          if (att && !seenAttachments.has(att)) {
            seenAttachments.add(att);
            mergedAttachments.push(att);
          }
        }
      }
      if (!firstReplyPost && (p.replyText || p.replyAuthor)) {
        firstReplyPost = p;
      }
      if (!firstQuotePost && (isPostWithQuote(p) || p.quoteText || p.quoteAuthor)) {
        firstQuotePost = p;
      }
    }

    return {
      ...basePost,
      text: mergedText,
      images: mergedImages,
      attachments: mergedAttachments,
      replyAuthor: firstReplyPost ? firstReplyPost.replyAuthor : '',
      replyText: firstReplyPost ? firstReplyPost.replyText : '',
      hasQuote: group.some(p => isPostWithQuote(p)),
      quoteUrl: (firstQuotePost && firstQuotePost.quoteUrl) || basePost.quoteUrl || '',
      quoteAuthor: (firstQuotePost && firstQuotePost.quoteAuthor) || basePost.quoteAuthor || '',
      quoteText: (firstQuotePost && firstQuotePost.quoteText) || basePost.quoteText || '',
      isPinned: group.some(p => p.isPinned),
      isRetweet: group.some(p => p.isRetweet),
      isUnread: group.some(p => p.isUnread),
      linkTitles: Object.keys(mergedLinkTitles).length > 0 ? mergedLinkTitles : undefined,
      isMerged: true,
      mergedPosts: group
    };
  });
}

function buildDiscordBubbleData(msg, { showAuthor }) {
  if (msg && msg.linkTitles) {
    registerUrlTitlesMap(msg.linkTitles, { persist: false });
  }
  const images = Array.isArray(msg.images) ? msg.images.filter(Boolean) : [];
  const rawText = stripEmptyLines(normalizeMediaOnlyText(stripDiscordEditedText(msg.text || '')));
  const isMediaFallbackOnly = images.length > 0 && rawText === t('scraper.mediaOnlyFallback');
  const effectiveText = isMediaFallbackOnly ? '' : rawText;
  const cleanReplyText = stripEmptyLines(stripDiscordEditedText(msg.replyText || ''));
  const displayText = replaceUrlsWithTitles(effectiveText, msg.linkTitles);
  const chars = Array.from(displayText);
  const isLong = !msg.isMerged && chars.length > BASE_PREVIEW_CHARS;
  const { slicedText: previewText, linkTitles: previewTitles } = isLong
    ? sliceTextWithUrlTitles(effectiveText, BASE_PREVIEW_CHARS, msg.linkTitles)
    : { slicedText: effectiveText, linkTitles: msg.linkTitles };

  const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const visibleAttachments = (images.length > 0
    ? rawAttachments.filter(a => !isImageAttachmentLabel(a))
    : rawAttachments
  ).map(a => translateAttachmentLabel(a));

  const reply = (cleanReplyText || msg.replyAuthor)
    ? {
        author: msg.replyAuthor || '',
        html: formatTextWithTickers(cleanReplyText, cleanReplyText, { linkTitles: msg.linkTitles })
      }
    : null;

  const text = effectiveText
    ? {
        isLong,
        fullText: effectiveText,
        html: isLong
          ? renderTruncatedTextHtml(previewText.trimEnd(), effectiveText, previewTitles)
          : formatTextWithTickers(effectiveText, effectiveText, { linkTitles: msg.linkTitles })
      }
    : null;

  return {
    showAuthor: Boolean(showAuthor && msg.displayName),
    authorName: msg.displayName || '',
    authorColor: msg.displayName ? authorColor(msg.displayName) : '',
    isBot: Boolean(msg.isBot),
    tags: [],
    reply,
    text,
    attachments: visibleAttachments
  };
}

function buildPostBubbleData(post) {
  if (post && post.linkTitles) {
    registerUrlTitlesMap(post.linkTitles, { persist: false });
  }
  const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
  if (typeof post.text === 'string' && post.text.includes('\n')) {
    post.text = cleanInlineEntityNewlines(post.text);
  }
  const rawText = stripEmptyLines(normalizeMediaOnlyText((post.text || '').trim()));
  const isMediaFallbackOnly = images.length > 0 && rawText === t('scraper.mediaOnlyFallback');
  const effectiveText = isMediaFallbackOnly
    ? ''
    : (rawText || (images.length === 0 ? t('scraper.mediaOnlyFallback') : ''));
  const displayText = replaceUrlsWithTitles(effectiveText, post.linkTitles);
  const chars = Array.from(displayText);
  const isLong = !post.isMerged && chars.length > BASE_PREVIEW_CHARS;
  const { slicedText: previewText, linkTitles: previewTitles } = isLong
    ? sliceTextWithUrlTitles(effectiveText, BASE_PREVIEW_CHARS, post.linkTitles)
    : { slicedText: effectiveText, linkTitles: post.linkTitles };

  const tags = [];
  if (post.isPinned) tags.push({ type: 'pinned', label: t('slot.tagPinned') });
  if (post.isRetweet) tags.push({ type: 'repost', label: t('slot.tagRepost') });
  if (isPostWithQuote(post)) tags.push({ type: 'quote', label: t('slot.tagQuote') });
  if (isMemberOnlyPost(post)) {
    tags.push({
      type: 'member',
      label: t('slot.tagMemberOnly'),
      title: t('slot.tagMemberOnlyTitle')
    });
  }

  const text = effectiveText
    ? {
        isLong,
        fullText: effectiveText,
        html: isLong
          ? renderTruncatedTextHtml(previewText.trimEnd(), effectiveText, previewTitles)
          : formatTextWithTickers(effectiveText, effectiveText, { linkTitles: post.linkTitles })
      }
    : null;

  return {
    showAuthor: false,
    authorName: '',
    authorColor: '',
    isBot: false,
    tags,
    reply: null,
    text,
    attachments: []
  };
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

  const finalAvatar = avatarUrl || (slot.avatarImg && slot.avatarImg.src) || '';

  const markBubbleAsRead = (postObj, bubbleEl) => {
    let changed = false;
    if (bubbleEl && bubbleEl.classList.contains('unread')) {
      bubbleEl.classList.remove('unread');
      changed = true;
    }
    const targetPosts = (postObj && Array.isArray(postObj.mergedPosts))
      ? [postObj, ...postObj.mergedPosts]
      : (postObj ? [postObj] : []);
    const targetKeys = new Set();
    targetPosts.forEach(tp => {
      if (!tp) return;
      if (tp.isUnread) {
        tp.isUnread = false;
        changed = true;
      }
      const k = getPostKey(tp);
      if (k) targetKeys.add(k);
    });
    if (targetKeys.size > 0 && Array.isArray(slot.loadedPosts)) {
      slot.loadedPosts.forEach(p => {
        if (p && targetKeys.has(getPostKey(p)) && p.isUnread) {
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

  displayPosts.forEach((p) => {
    if (!p.source && slot.source) {
      p.source = slot.source;
    }
    if (!p.avatarUrl && finalAvatar) {
      p.avatarUrl = finalAvatar;
    }
    if (!isDiscord) {
      if (!p.displayName && displayName) p.displayName = displayName;
      if (!p.userHandle && userHandle) p.userHandle = userHandle;
    }
  });

  const groupedDisplayPosts = groupSameMinutePosts(displayPosts, { isDiscord });

  let lastDateKey = null;
  let lastAuthorName = null;

  const timelineItems = groupedDisplayPosts.map((post, idx) => {
    const dateKey = getPostDateKey(post);
    const dateLabel = getPostDateLabel(post);
    let startedNewDay = false;
    let dateDividerLabel = null;

    if (dateKey && dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      startedNewDay = true;
      dateDividerLabel = dateLabel;
    }

    const timeDisplay = formatTelegramTime(post);
    const linkTitle = isDiscord
      ? t('slot.openOriginalDiscord')
      : (isThreads ? t('slot.openOriginalThreads') : t('slot.openOriginalPost'));

    let body;
    let isGrouped = false;
    if (isDiscord) {
      const showAuthor = startedNewDay || post.displayName !== lastAuthorName;
      body = buildDiscordBubbleData(post, { showAuthor });
      isGrouped = !showAuthor;
      lastAuthorName = post.displayName;
    } else {
      body = buildPostBubbleData(post);
    }

    const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
    const hasMedia = images.length > 0;
    const isMediaOnly =
      hasMedia &&
      !body.text &&
      !body.reply &&
      (!Array.isArray(body.attachments) || body.attachments.length === 0);

    return {
      key: `${getPostKey(post) || idx}-${idx}`,
      dateDividerLabel,
      post,
      isDiscord,
      isThreads,
      isUnread: Boolean(post.isUnread),
      isMemberOnly: isMemberOnlyPost(post),
      isGrouped,
      hasPopup: shouldShowPostPopup(post),
      hasMedia,
      isMediaOnly,
      images,
      imageAlt: t('slot.imageAlt'),
      timeDisplay,
      linkUrl: post.url || '',
      linkTitle,
      body
    };
  });

  const emptyNoticeText =
    displayPosts.length === 0 && posts.length > 0 && !isDiscord && !isThreads
      ? t('slot.hiddenMemberPosts', { count: posts.length })
      : '';

  renderMantineSlotPosts(slot.postsList, {
    items: timelineItems,
    emptyNoticeText,
    contentContainer: slot.contentContainer,
    onMarkRead: markBubbleAsRead,
    onOpenExternal: (url) => shell.openExternal(url),
    onPrefetch: (p) => prefetchPost(p, { priority: true }),
    onOpenPopup: (p) => openPostPopup(p)
  });

  slot.postsList.querySelectorAll('.im-bubble').forEach((bubble) => {
    expandBubbleLastLine(bubble);
  });

  // Auto-scroll to bottom to show the latest messages (Telegram style)
  requestAnimationFrame(() => {
    if (slot.contentContainer) {
      slot.contentContainer.scrollTop = slot.contentContainer.scrollHeight;
    }
  });

  persistSlot(slot, { handle, displayName, userHandle, posts, avatarUrl: finalAvatar }, slots);

  if (Array.isArray(posts) && posts.length > 0) {
    resolveSlotUrlTitles(slot, slots);
  }

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

function refreshSlotBubbleTextsWithTitles(slot) {
  if (!slot || !slot.postsList) return;
  const isDiscord = isDiscordSlot(slot);
  const bubbles = slot.postsList.querySelectorAll('.im-bubble');
  bubbles.forEach((bubble) => {
    const post = bubble._post;
    if (!post) return;

    if (post.isMerged && Array.isArray(post.mergedPosts)) {
      const mergedLinkTitles = Object.assign({}, post.linkTitles || {});
      for (const mp of post.mergedPosts) {
        if (mp && mp.linkTitles && typeof mp.linkTitles === 'object') {
          Object.assign(mergedLinkTitles, mp.linkTitles);
        }
      }
      if (Object.keys(mergedLinkTitles).length > 0) {
        post.linkTitles = mergedLinkTitles;
        registerUrlTitlesMap(mergedLinkTitles, { persist: false });
      }
      const cleanSegments = post.mergedPosts
        .map(p => extractCleanPostText(p, { isDiscord }))
        .filter(Boolean);
      const forceChinese = cleanSegments.some(s => hasChineseText(replaceUrlsWithTitles(s, post.linkTitles)));
      post.text = joinSameMinuteTexts(cleanSegments, { forceChinese });
    } else if (post.linkTitles) {
      registerUrlTitlesMap(post.linkTitles, { persist: false });
    }

    const replyTextEl = bubble.querySelector('.im-reply-text');
    if (replyTextEl && post.replyText) {
      const cleanReply = stripEmptyLines(stripDiscordEditedText(post.replyText || ''));
      replyTextEl.innerHTML = formatTextWithTickers(cleanReply, cleanReply, { linkTitles: post.linkTitles });
    }

    const textContentEl = bubble.querySelector('.im-text-content');
    if (!textContentEl) return;

    const images = Array.isArray(post.images) ? post.images.filter(Boolean) : [];
    const rawText = isDiscord
      ? stripEmptyLines(normalizeMediaOnlyText(stripDiscordEditedText(post.text || '')))
      : stripEmptyLines(normalizeMediaOnlyText((post.text || '').trim()));
    const isMediaFallbackOnly = images.length > 0 && rawText === t('scraper.mediaOnlyFallback');
    const effectiveText = isMediaFallbackOnly
      ? ''
      : (rawText || (!isDiscord && images.length === 0 ? t('scraper.mediaOnlyFallback') : ''));

    if (!effectiveText) return;

    const displayText = replaceUrlsWithTitles(effectiveText, post.linkTitles);
    const chars = Array.from(displayText);
    const isLong = !post.isMerged && chars.length > BASE_PREVIEW_CHARS;

    if (isLong) {
      const { slicedText: previewText, linkTitles: previewTitles } = sliceTextWithUrlTitles(
        effectiveText,
        BASE_PREVIEW_CHARS,
        post.linkTitles
      );
      textContentEl.setAttribute('data-full-text', effectiveText);
      textContentEl.innerHTML = renderTruncatedTextHtml(previewText.trimEnd(), effectiveText, previewTitles);
      expandBubbleLastLine(bubble);
    } else {
      textContentEl.removeAttribute('data-full-text');
      textContentEl.innerHTML = formatTextWithTickers(effectiveText, effectiveText, { linkTitles: post.linkTitles });
    }
  });
}

async function resolveSlotUrlTitles(slot, slots = []) {
  if (!slot || slot._isResolvingUrlTitles) return;
  const posts = Array.isArray(slot.loadedPosts) ? slot.loadedPosts : [];
  if (posts.length === 0) return;

  const urlToPosts = new Map();
  for (const p of posts) {
    if (!p) continue;
    if (p.linkTitles && typeof p.linkTitles === 'object') {
      registerUrlTitlesMap(p.linkTitles, { persist: false });
    }
    const texts = [p.text, p.replyText, p.quoteText].filter(Boolean);
    for (const txt of texts) {
      const urls = extractUrlsFromText(txt);
      for (const u of urls) {
        const existingLocal = p.linkTitles && p.linkTitles[u];
        if (existingLocal) continue;
        if (!urlToPosts.has(u)) {
          urlToPosts.set(u, []);
        }
        urlToPosts.get(u).push(p);
      }
    }
  }

  if (urlToPosts.size === 0) return;

  slot._isResolvingUrlTitles = true;
  let anyResolved = false;

  try {
    const limit = pLimit(4);
    await Promise.all(
      Array.from(urlToPosts.entries()).map(([url, targetPosts]) =>
        limit(async () => {
          try {
            const title = await fetchUrlTitle(url);
            if (title) {
              anyResolved = true;
              for (const tp of targetPosts) {
                if (!tp.linkTitles || typeof tp.linkTitles !== 'object') {
                  tp.linkTitles = {};
                }
                tp.linkTitles[url] = title;
              }
            }
          } catch (_) {}
        })
      )
    );

    if (anyResolved && Array.isArray(slot.loadedPosts) && slot.loadedPosts.length > 0) {
      refreshSlotBubbleTextsWithTitles(slot);
      const handle = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
      const avatarUrl = (slot.avatarImg && slot.avatarImg.src) || '';
      persistSlot(slot, {
        handle,
        displayName: slot.authorName ? slot.authorName.innerText : '',
        userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
        posts: slot.loadedPosts,
        avatarUrl
      }, slots);
      archiveSlotScrapedData(slot);
    }
  } finally {
    slot._isResolvingUrlTitles = false;
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
    const limit = pLimit(4);
    await Promise.all(
      toBackfill.map(({ post, postId }) =>
        limit(async () => {
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
      )
    );

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
  clearMantineSlotPosts(slot.postsList);
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
  clearMantineSlotPosts(slot.postsList);
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

  if (slot.expandIcon) {
    renderMantineExpandIcon(slot.expandIcon, r, c);
  }

  if (isExpanded) {
    slot.card.classList.add('is-priority');
    slot.btnExpand.classList.add('expanded');
    slot.btnExpand.title = t('slot.currentSizeTitle', { r, c });
  } else {
    slot.card.classList.remove('is-priority');
    slot.btnExpand.classList.remove('expanded');
    slot.btnExpand.title = t('slot.resizeCardTitle');
  }
}

function syncSlotHeaderOpenMenuState(slot) {
  if (!slot || !slot.header) return;
  const isSizeMenuOpen = Boolean(slot.sizeMenu && slot.sizeMenu.style.display === 'flex');
  const isSourceDropdownOpen = Boolean(slot.sourceDropdown && slot.sourceDropdown.style.display === 'flex');
  const hasOpenMenu = isSizeMenuOpen || isSourceDropdownOpen;
  slot.header.classList.toggle('has-open-menu', hasOpenMenu);
  if (hasOpenMenu && slot.card) {
    slot.card.classList.remove('is-header-hidden');
  }
}

function closeSlotSourceDropdown(slot) {
  if (!slot || !slot.sourceDropdown) return;
  slot.sourceDropdown.style.display = 'none';
  clearMantineSlotSourceDropdown(slot.sourceDropdown);
  slot._dropdownHandle = '';
  slot._dropdownOnSelect = null;
  syncSlotHeaderOpenMenuState(slot);
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
      syncSlotHeaderOpenMenuState(s);
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

  slot._dropdownHandle = cleanHandle.toLowerCase();
  slot._dropdownOnSelect = onSelect;

  renderMantineSlotSourceDropdown(slot.sourceDropdown, {
    titleText: t('slot.choosePlatformTitle', { handle: cleanHandle }),
    twName,
    twHandle,
    twAvatar,
    twBadgeText: t('slot.platformTwitterBadge'),
    thName,
    thHandle,
    thAvatar,
    thBadgeText: t('slot.platformThreadsBadge'),
    onSelect: (chosenSource) => {
      const cb = slot._dropdownOnSelect;
      closeSlotSourceDropdown(slot);
      if (typeof cb === 'function') {
        cb(chosenSource);
      }
    }
  });

  slot.sourceDropdown.style.display = 'flex';
  syncSlotHeaderOpenMenuState(slot);

  slot.sourceDropdown.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
}

function closeAllSizeMenus(slots) {
  if (!Array.isArray(slots)) return;
  slots.forEach(s => {
    if (s.sizeMenu) s.sizeMenu.style.display = 'none';
    closeSlotSourceDropdown(s);
    syncSlotHeaderOpenMenuState(s);
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

  const items = options.map((opt) => {
    const key = `${opt.r}x${opt.c}`;
    const isActive = curKey === key;
    const disabled = opt.r > currentRows || opt.c > currentCols;
    let hint = opt.desc;
    if (opt.r > currentRows) hint = t('slot.needRows', { r: opt.r });
    else if (opt.c > currentCols) hint = t('slot.needCols', { c: opt.c });

    return {
      r: opt.r,
      c: opt.c,
      label: opt.label,
      hint,
      isActive,
      disabled
    };
  });

  renderMantineSlotSizeMenu(slot.sizeMenu, {
    titleText: t('slot.sizeMenuTitle'),
    items,
    clearLabel: t('slot.clearSlotLabel'),
    clearDesc: t('slot.clearSlotDesc'),
    onSelectSize: (targetR, targetC) => {
      closeAllSizeMenus(slots);
      if (onResize) {
        onResize(slot, targetC, targetR);
      }
    },
    onClearSlot: () => {
      closeAllSizeMenus(slots);
      clearSlot(slot, { slots });
    }
  });

  slot.sizeMenu.style.display = 'flex';
  syncSlotHeaderOpenMenuState(slot);
}

function bindSlotEvents(slot, { slots, onFetch, onResize, getGridDimensions }) {
  const updateClearVisibility = () => {
    if (slot.btnClear) {
      slot.btnClear.style.display = slot.handleInput.value.trim().length > 0 ? 'flex' : 'none';
    }
  };

  if (slot.element) {
    slot.element.addEventListener('mouseleave', () => {
      if (slot.card) {
        slot.card.classList.remove('is-header-hidden');
      }
    });
  }

  if (slot.header) {
    slot.header.addEventListener('mouseenter', () => {
      if (slot.card) {
        slot.card.classList.remove('is-header-hidden');
      }
    });
  }

  if (slot.contentContainer) {
    slot.contentContainer.addEventListener('mouseenter', () => {
      if (!slot.card) return;
      const hasOpenMenu = Boolean(slot.header && slot.header.classList.contains('has-open-menu'));
      const isInputFocused = Boolean(slot.handleInput && document.activeElement === slot.handleInput);
      if (!hasOpenMenu && !isInputFocused) {
        slot.card.classList.add('is-header-hidden');
      }
    });
  }

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

  slot.handleInput.addEventListener('focus', () => {
    if (slot.card) {
      slot.card.classList.remove('is-header-hidden');
    }
  });

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
      header: el.querySelector('.slot-header'),
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
      expiredBanner: el.querySelector(`#slot-expired-banner-${i}`),
      expiredText: el.querySelector(`#slot-expired-text-${i}`),
      expiredBtn: el.querySelector(`#slot-expired-btn-${i}`),
      isFetching: false,
      isMuted: typeof savedMuted[i] === 'boolean' ? savedMuted[i] : DEFAULT_SLOT_MUTED,
      loadedPosts: []
    };

    if (slot.expiredBtn) {
      slot.expiredBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlatformLoginWindow(getSlotSource(slot));
      });
    }

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
    updateSlotExpiredUI(slot);

    slots.push(slot);
    bindSlotEvents(slot, { slots, onFetch, onResize, getGridDimensions });
  }

  registeredSlots = slots;
  syncAppUnreadBadge(slots);
  return slots;
}

function loadSlotCache(slots) {
  try {
    if (Array.isArray(slots) && slots.length > 0) {
      registeredSlots = slots;
    }
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
    syncAppUnreadBadge(slots);
  } catch (e) {}
}

function markAllPostsAsRead(slots) {
  slots.forEach(slot => {
    markSlotPostsAsRead(slot, slots);
  });
  syncAppUnreadBadge(slots);
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
  syncAppUnreadBadge(slots);
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
    updateSlotExpiredUI(slot);
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
  updateSlotHeaderMeta,
  updateSlotExpiredUI,
  updateAllSlotsExpiredUI,
  getSlotUnreadCount,
  syncAppUnreadBadge,
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

