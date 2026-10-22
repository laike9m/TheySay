const { ipcRenderer } = require('electron');
const { processAndSortTweets, isMemberOnlyTweet, isTweetWithQuote } = require('./tweet');
const { getShowMemberOnlyTweets } = require('./storage');
const { SOURCE_DISCORD, SOURCE_THREADS, normalizeThreadsHandle } = require('./source');
const {
  t,
  translateAttachmentLabel,
  normalizeDiscordChannelFallback,
  normalizeMediaOnlyText
} = require('./i18n');

let isNotificationListenerBound = false;

function compactSingleLine(str, maxLen = 140) {
  const cleaned = String(str || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  if (chars.length <= maxLen) return cleaned;
  return `${chars.slice(0, maxLen).join('')}…`;
}

function requestNotificationPermission() {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (window.Notification.permission === 'default') {
        window.Notification.requestPermission().catch(() => {});
      }
    }
  } catch (e) {}
}

function sendSystemNotification({ title, subtitle = '', body = '', slotIndex = null }) {
  if (!title && !body) return;

  if (ipcRenderer) {
    ipcRenderer.send('show-system-notification', {
      title: String(title || 'TheySay'),
      subtitle: subtitle ? String(subtitle) : '',
      body: String(body || ''),
      slotIndex: typeof slotIndex === 'number' ? slotIndex : null
    });
    return;
  }

  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const fullBody = subtitle ? `${subtitle}\n${body}` : body;
      new window.Notification(String(title || 'TheySay'), {
        body: String(fullBody || ''),
        silent: false
      });
    }
  } catch (e) {}
}

/**
 * Triggers a system notification for newly fetched tweets, Threads posts, or Discord messages
 * on `slot` when that slot's mute toggle is turned off (`slot.isMuted === false`).
 */
function notifySlotNewMessages(slot, newItems) {
  if (!slot || slot.isMuted !== false) return;
  if (!Array.isArray(newItems) || newItems.length === 0) return;

  const isDiscord = slot.source === SOURCE_DISCORD;
  const isThreads = slot.source === SOURCE_THREADS;
  const showMemberOnly = getShowMemberOnlyTweets();

  const visibleItems = (showMemberOnly || isDiscord || isThreads)
    ? newItems
    : newItems.filter(item => !isMemberOnlyTweet(item));

  if (visibleItems.length === 0) return;

  const sorted = processAndSortTweets(visibleItems);
  const latest = sorted[sorted.length - 1] || visibleItems[0];
  const count = visibleItems.length;

  if (isDiscord) {
    const channelTitle = normalizeDiscordChannelFallback(
      slot.sourceTitle || (slot.authorName && slot.authorName.innerText) || t('slot.defaultDiscordChannel')
    ).trim();
    const serverSubtitle = (slot.sourceSubtitle || (slot.authorHandle && slot.authorHandle.innerText) || '').trim();
    const title = serverSubtitle ? `${channelTitle} · ${serverSubtitle}` : channelTitle;
    const subtitle = count > 1 ? t('notification.discordNewMessagesCount', { count }) : '';

    let contentText = compactSingleLine(latest.text || '');
    if (!contentText) {
      if (Array.isArray(latest.images) && latest.images.length > 0) {
        contentText = latest.images.length > 1
          ? t('notification.imagePlural', { count: latest.images.length })
          : t('notification.imageSingle');
      } else if (Array.isArray(latest.attachments) && latest.attachments.length > 0) {
        contentText = `[${latest.attachments.map(translateAttachmentLabel).join(' / ')}]`;
      } else if (latest.replyText) {
        contentText = `${t('notification.replyPrefix')} ${compactSingleLine(latest.replyText, 80)}`;
      } else {
        contentText = t('notification.newMessagePlaceholder');
      }
    }

    const sender = compactSingleLine(latest.displayName || '', 40);
    const body = sender ? `${sender}: ${contentText}` : contentText;

    sendSystemNotification({
      title,
      subtitle,
      body,
      slotIndex: slot.index
    });
  } else {
    const handle = slot.monitoredHandle || (
      slot.handleInput
        ? (isThreads
            ? normalizeThreadsHandle(slot.handleInput.value)
            : slot.handleInput.value.trim().replace(/^@/, ''))
        : ''
    );
    const rawAuthorName = compactSingleLine(
      (slot.authorName && slot.authorName.innerText) || latest.displayName || `@${handle}`,
      50
    );
    const rawAuthorHandle = compactSingleLine(
      (slot.authorHandle && slot.authorHandle.innerText) || latest.userHandle || (handle ? `@${handle}` : ''),
      40
    );

    const bareName = rawAuthorName.replace(/^@/, '').toLowerCase();
    const bareHandle = rawAuthorHandle.replace(/^@/, '').toLowerCase();

    const baseTitle = (rawAuthorName && rawAuthorHandle && bareName !== bareHandle)
      ? `${rawAuthorName} (${rawAuthorHandle})`
      : (rawAuthorName || rawAuthorHandle || (isThreads ? 'Threads' : 'Twitter / X'));
    const title = isThreads ? `${baseTitle} · Threads` : baseTitle;

    let tagDesc = t('notification.newTweet');
    if (latest.isRetweet) tagDesc = t('notification.repost');
    else if (isTweetWithQuote(latest)) tagDesc = t('notification.quoteTweet');
    else if (isMemberOnlyTweet(latest)) tagDesc = t('notification.memberOnlyTweet');

    const subtitle = count > 1 ? t('notification.newTweetsCount', { count }) : tagDesc;
    const body = compactSingleLine(normalizeMediaOnlyText(latest.text || t('notification.mediaContentPlaceholder')));

    sendSystemNotification({
      title,
      subtitle,
      body,
      slotIndex: slot.index
    });
  }
}

function initNotifications(slots) {
  if (isNotificationListenerBound || !ipcRenderer) return;
  isNotificationListenerBound = true;

  ipcRenderer.on('notification-clicked', (event, payload = {}) => {
    const { slotIndex } = payload;
    if (typeof slotIndex !== 'number' || !Array.isArray(slots)) return;
    const slot = slots[slotIndex];
    if (!slot || !slot.card) return;

    if (slot.element && typeof slot.element.scrollIntoView === 'function') {
      slot.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (slot.contentContainer) {
      slot.contentContainer.scrollTop = slot.contentContainer.scrollHeight;
    }

    slot.card.classList.remove('slot-card-notify-focus');
    void slot.card.offsetWidth;
    slot.card.classList.add('slot-card-notify-focus');
    setTimeout(() => {
      if (slot.card) slot.card.classList.remove('slot-card-notify-focus');
    }, 1800);
  });
}

module.exports = {
  requestNotificationPermission,
  sendSystemNotification,
  notifySlotNewMessages,
  initNotifications
};
