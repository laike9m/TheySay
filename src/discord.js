const {
  DISCORD_PARTITION,
  DISCORD_WEBVIEW_ID,
  MAX_DISCORD_MESSAGES
} = require('./constants');
const { sleep, showToast, isNetworkOnline, canReachHost, stripDiscordEditedText } = require('./utils');
const {
  processAndSortPosts,
  getPostKey,
  ensureSlotReadTracking,
  recordSlotReadPosts,
  shouldMarkScrapedItemUnread,
  resetSlotReadTracking
} = require('./post');
const {
  saveHandles,
  saveLastFetchTime,
  saveLastFetchTimeDiscord,
  saveDiscordLoggedIn,
  getDiscordSoundEnabled
} = require('./storage');
const { waitForWebviewReady, loadWebviewTarget, executeWebviewScript } = require('./webview');
const {
  parseDiscordChannelUrl,
  buildDiscordChannelUrl,
  buildDiscordMessageUrl,
  getCanonicalTargetKey,
  SOURCE_DISCORD
} = require('./source');
const {
  updateSlotAvatar,
  updateSlotHeaderMeta,
  updateSlotFetchTimeUI,
  showSlotLoading,
  showSlotError,
  renderSlotPosts,
  persistSlot,
  archiveSlotScrapedData,
  restoreSlotFromTargetCache
} = require('./slot');
const { notifySlotNewMessages } = require('./notification');
const { t, normalizeDiscordChannelFallback } = require('./i18n');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Cold-booting the Discord SPA (gateway handshake + guild sync) is slow; a warm
// in-app channel switch is not.
const BOOT_TIMEOUT_MS = 45000;
const SWITCH_TIMEOUT_MS = 20000;

/* ----------------------------------------------------------------
   Shared Discord client
   ---------------------------------------------------------------- */

// Every Discord slot shares one client instance, so all access has to be
// serialized: a manual refresh must not yank the channel out from under the
// background crawler.
let discordQueue = Promise.resolve();

function withDiscordLock(fn) {
  const run = discordQueue.then(fn, fn);
  // Keep the chain alive even when a job rejects.
  discordQueue = run.then(() => {}, () => {});
  return run;
}

function getOrCreateDiscordWebview(container) {
  let wv = document.getElementById(DISCORD_WEBVIEW_ID);
  if (!wv) {
    wv = document.createElement('webview');
    wv.id = DISCORD_WEBVIEW_ID;
    wv.src = 'about:blank';
    wv.setAttribute('partition', DISCORD_PARTITION);
    wv.setAttribute('useragent', USER_AGENT);
    // Discord throttles hard when it thinks it is hidden, which would stall the
    // message list right when we want to read it.
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });
    // The mute flag lives on the guest WebContents, which only exists once the
    // webview is attached, so (re)apply the preference on every page load.
    wv.addEventListener('dom-ready', () => applyDiscordSoundSetting(wv));

    if (container) container.appendChild(wv);
  }
  return wv;
}

/**
 * Syncs the shared client's audio with the "Discord 通知声音" preference.
 *
 * Even while running unattended offscreen, the web app plays its own pings for
 * DMs, @mentions, etc. Muting the guest WebContents silences every sound the
 * page can make (HTMLAudio and Web Audio alike) without affecting scraping.
 */
function applyDiscordSoundSetting(wv = document.getElementById(DISCORD_WEBVIEW_ID)) {
  if (!wv) return;
  try {
    wv.setAudioMuted(!getDiscordSoundEnabled());
  } catch (e) {
    // Not attached yet; the dom-ready hook applies it once the guest exists.
  }
}

/* ----------------------------------------------------------------
   In-page scripts
   ---------------------------------------------------------------- */

// Shared prelude: helpers that every injected snippet needs.
// NOTE: this string is embedded in template literals, so every backslash that
// should survive into the page (e.g. regex escapes) must be doubled. We avoid
// regexes here entirely to keep that risk at zero.
const PAGE_HELPERS = `
  const getList = () => document.querySelector('ol[data-list-id="chat-messages"]');
  const getScroller = () => {
    const list = getList();
    if (!list) return null;
    let el = list.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return null;
  };
  const pathParts = () => (location.pathname || '').split('/');
  const isLoginPage = () => {
    const p = location.pathname || '';
    return p.indexOf('/login') === 0 || p.indexOf('/register') === 0;
  };
`;

/**
 * Probes whether the client has finished switching to (and rendering) the
 * requested channel. Returning the rendered channel id is what guarantees we
 * never scrape leftover messages from the previously opened channel.
 */
function buildReadinessScript(channelId) {
  return `
  (() => {
    try {
      const CHANNEL_ID = ${JSON.stringify(String(channelId))};
      ${PAGE_HELPERS}

      if (isLoginPage()) return { state: 'login' };

      const parts = pathParts();
      if (parts[1] !== 'channels') return { state: 'booting', path: location.pathname };
      if (parts[3] !== CHANNEL_ID) return { state: 'switching', path: location.pathname };

      const list = getList();
      if (!list) return { state: 'rendering' };

      const rows = list.querySelectorAll('li[id^="chat-messages-"]');
      if (rows.length === 0) {
        const emptyContainer = document.querySelector('[class*="emptyChannelIcon"], [class*="emptyChannel"], [data-list-id="chat-messages"] [class*="container"]');
        const activeLink = document.querySelector(
          '[data-list-item-id="channels___' + CHANNEL_ID + '"][class*="selected"], ' +
          '[data-list-item-id="channels___' + CHANNEL_ID + '"][aria-selected="true"], ' +
          'a[href$="/' + CHANNEL_ID + '"][class*="selected"]'
        );
        if (emptyContainer || activeLink) {
          return { state: 'ready', count: 0, isEmpty: true };
        }
        return { state: 'rendering' };
      }

      // Verify that the messages currently in the DOM actually belong to CHANNEL_ID.
      // Discord message element IDs are: chat-messages-<channelId>-<messageId>
      let matchesThisChannel = false;
      let matchesOtherChannel = false;

      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const idParts = (rows[i].id || '').split('-');
        if (idParts.length >= 4) {
          if (idParts[2] === CHANNEL_ID) {
            matchesThisChannel = true;
            break;
          } else {
            matchesOtherChannel = true;
          }
        }
      }

      if (matchesOtherChannel && !matchesThisChannel) {
        return { state: 'switching', reason: 'stale-messages' };
      }

      if (!matchesThisChannel) {
        const activeLink = document.querySelector(
          '[data-list-item-id="channels___' + CHANNEL_ID + '"][class*="selected"], ' +
          '[data-list-item-id="channels___' + CHANNEL_ID + '"][aria-selected="true"], ' +
          'a[href$="/' + CHANNEL_ID + '"][class*="selected"]'
        );
        if (!activeLink && document.querySelector('[data-list-item-id^="channels___"][class*="selected"]')) {
          return { state: 'switching', reason: 'other-channel-selected' };
        }
      }

      return { state: 'ready', count: rows.length };
    } catch (e) {
      return { state: 'error', error: String(e && e.message || e) };
    }
  })()
  `;
}

/**
 * Attempts an in-app channel click if the channel is visible in the sidebar
 * (i.e. within the same guild).
 */
function buildInAppChannelClickScript(guildId, channelId) {
  return `
  (() => {
    try {
      const CHANNEL_ID = ${JSON.stringify(String(channelId))};
      const GUILD_ID = ${JSON.stringify(String(guildId))};
      const el = document.querySelector(
        '[data-list-item-id="channels___' + CHANNEL_ID + '"], ' +
        'a[href*="/channels/' + GUILD_ID + '/' + CHANNEL_ID + '"], ' +
        'a[href$="/' + CHANNEL_ID + '"]'
      );
      if (el) {
        el.click();
        return { ok: true, clicked: true };
      }
      return { ok: false, clicked: false, error: 'CHANNEL_LINK_NOT_FOUND' };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })()
  `;
}

/**
 * Pins the message list to the newest message. Discord restores the last read
 * position when a channel has unreads, so without this we would scrape stale
 * history instead of what just came in.
 */
const JUMP_TO_PRESENT_SCRIPT = `
  (() => {
    try {
      ${PAGE_HELPERS}
      const scroller = getScroller();

      // The "Jump to Present" bar skips the whole unread backlog in one hop.
      const bar = document.querySelector(
        '[class*="jumpToPresentBar"] button, [class*="jumpToPresentBar"] [role="button"], button[class*="jumpToPresentBar"], [class*="jumpToPresentBar"], ' +
        '[class*="newMessagesBar"] button, [class*="newMessagesBar"] [role="button"], button[class*="newMessagesBar"], [class*="newMessagesBar"]'
      );
      if (bar) {
        bar.click();
        return { jumped: true, atBottom: false };
      }

      if (!scroller) return { jumped: false, atBottom: true, noScroller: true };
      scroller.scrollTop = scroller.scrollHeight;
      const atBottom = (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 8;
      return { jumped: false, atBottom: atBottom };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()
`;

/** Scrolls the history upwards to pull in older messages. */
const SCROLL_UP_SCRIPT = `
  (() => {
    try {
      ${PAGE_HELPERS}
      const scroller = getScroller();
      if (!scroller) return { ok: false };
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.round(scroller.clientHeight * 0.85));
      return { ok: true, moved: before !== scroller.scrollTop, atTop: scroller.scrollTop <= 2 };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })()
`;

/**
 * Reads the currently rendered messages.
 *
 * Discord's class names are build hashes and churn constantly, so everything
 * here keys off stable `id` prefixes (`chat-messages-`, `message-content-`,
 * `message-username-`) and falls back to loose class *substring* matches only
 * for decoration.
 */
function buildDiscordExtractionScript(guildId, channelId) {
  return `
  (() => {
    try {
      const GUILD_ID = ${JSON.stringify(String(guildId))};
      const CHANNEL_ID = ${JSON.stringify(String(channelId))};
      ${PAGE_HELPERS}

      if (isLoginPage()) return { error: 'NOT_LOGGED_IN' };

      const parts = pathParts();
      if (parts[3] !== CHANNEL_ID) return { pending: true };

      const list = getList();
      if (!list) return { pending: true };

      // Text extraction that keeps custom emoji (rendered as <img alt=":tada:">),
      // mentions and line breaks intact — innerText would silently drop emoji.
      const readText = (root) => {
        if (!root) return '';
        let out = '';
        const walk = (node) => {
          const kids = node.childNodes;
          for (let i = 0; i < kids.length; i++) {
            const n = kids[i];
            if (n.nodeType === 3) {
              out += n.nodeValue;
            } else if (n.nodeType === 1) {
              const tag = n.tagName.toLowerCase();
              const idAttr = n.id || '';
              const cls = typeof n.className === 'string' ? n.className : '';
              if (
                idAttr.indexOf('message-edited-timestamp') === 0 ||
                cls.indexOf('edited') >= 0 ||
                cls.indexOf('hiddenVisually') >= 0 ||
                cls.indexOf('visuallyHidden') >= 0 ||
                ((tag === 'time' || cls.indexOf('timestamp') >= 0) &&
                  n.querySelector &&
                  n.querySelector('[class*="edited"], [id^="message-edited-timestamp"]'))
              ) {
                continue;
              }
              if (tag === 'img') {
                out += (n.getAttribute('alt') || '');
              } else if (tag === 'br') {
                out += '\\n';
              } else {
                const display = getComputedStyle(n).display;
                walk(n);
                if (display === 'block' || tag === 'p' || tag === 'li') out += '\\n';
              }
            }
          }
        };
        walk(root);
        return out
          .replace(/\\s*[(\\uff08]\\s*(?:已编辑|已編輯|edited)\\s*[)\\uff09]\\s*(?:\\d{4}\\s*年[^\\r\\n]*|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^\\r\\n]*)?/gi, '')
          .replace(/\\s*[(\\uff08]\\s*(?:已编辑|已編輯|edited)\\s*[)\\uff09][^\\r\\n]*$/i, '')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim();
      };

      const items = [];
      let lastAuthor = '';
      let lastAvatar = '';

      const rows = Array.from(list.children);
      for (const li of rows) {
        const id = li.id || '';
        if (id.indexOf('chat-messages-') !== 0) continue;

        const cls = typeof li.className === 'string' ? li.className : '';
        // Join / boost / pin notices add noise to a monitoring feed.
        if (cls.indexOf('systemMessage') >= 0) continue;

        const idParts = id.split('-');
        if (idParts.length >= 4 && idParts[2] !== CHANNEL_ID) continue;
        const messageId = idParts[idParts.length - 1];
        if (!messageId) continue;

        // A reply renders a preview of the message it answers, and that preview
        // carries its *own* message-content / avatar nodes. Everything below is
        // therefore anchored to this row's message id, with the reply subtree
        // explicitly excluded, so a quote can never masquerade as the body.
        const replyEl = li.querySelector('[id^="message-reply-context-"]');
        const outsideReply = (el) => !!el && (!replyEl || !replyEl.contains(el));
        const pickOutsideReply = (selector) => {
          const all = li.querySelectorAll(selector);
          for (let i = 0; i < all.length; i++) {
            if (outsideReply(all[i])) return all[i];
          }
          return null;
        };

        // A message group only carries the author header on its first row; the
        // rows that follow inherit it.
        const nameEl = pickOutsideReply('[id^="message-username-"] [class*="username"]')
          || pickOutsideReply('[id^="message-username-"]');
        const avatarEl = pickOutsideReply('img[class*="avatar"]:not([class*="replyAvatar"])');

        // textContent rather than innerText: it does not depend on the element
        // being laid out, which matters in an offscreen webview.
        let author = nameEl ? (nameEl.textContent || '').trim() : '';
        let avatar = avatarEl ? (avatarEl.src || '') : '';
        if (author) {
          lastAuthor = author;
          lastAvatar = avatar || '';
        } else {
          author = lastAuthor;
          avatar = avatar || lastAvatar;
        }

        const isBot = !!pickOutsideReply('[class*="botTag"]');

        const timeEl = document.getElementById('message-timestamp-' + messageId)
          || pickOutsideReply('time[datetime]');
        const datetime = timeEl ? (timeEl.getAttribute('datetime') || '') : '';

        const contentEl = document.getElementById('message-content-' + messageId)
          || pickOutsideReply('[id^="message-content-"]');
        let text = readText(contentEl);
        const isEdited = !!(contentEl && contentEl.querySelector('[class*="edited"]'));

        // Replies render as a small quoted preview above the message body.
        let replyAuthor = '';
        let replyText = '';
        if (replyEl) {
          const rName = replyEl.querySelector('[class*="username"]');
          replyAuthor = rName ? (rName.textContent || '').trim() : '';
          const rBody = replyEl.querySelector('[id^="message-content-"]') || replyEl;
          replyText = readText(rBody);
          if (replyAuthor && replyText.indexOf(replyAuthor) === 0) {
            replyText = replyText.slice(replyAuthor.length).trim();
          }
          if (replyText.length > 80) replyText = replyText.slice(0, 80) + '…';
        }

        // Extract inline images from DOM accessories and React message state
        const images = [];
        const seenImages = new Set();

        const isExcludedImageUrl = (raw) => {
          if (!raw || typeof raw !== 'string') return true;
          const u = raw.trim();
          if (u.indexOf('http://') !== 0 && u.indexOf('https://') !== 0 && u.indexOf('//') !== 0) return true;
          const lower = u.toLowerCase();
          if (
            lower.indexOf('/avatars/') >= 0 ||
            lower.indexOf('/icons/') >= 0 ||
            lower.indexOf('/emojis/') >= 0 ||
            lower.indexOf('/assets/') >= 0 ||
            lower.indexOf('/role-icons/') >= 0 ||
            lower.indexOf('/clan-badges/') >= 0 ||
            lower.indexOf('/badge-icons/') >= 0 ||
            lower.indexOf('/app-icons/') >= 0 ||
            lower.indexOf('/channel-icons/') >= 0 ||
            lower.indexOf('/guild-events/') >= 0
          ) return true;
          const pathPart = lower.split('?')[0].split('#')[0];
          const nonImgExts = [
            '.mp4', '.mov', '.webm', '.mkv', '.avi', '.mp3', '.wav', '.ogg', '.flac', '.m4a',
            '.zip', '.rar', '.7z', '.tar', '.gz', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
            '.ppt', '.pptx', '.txt', '.csv', '.json', '.js', '.py', '.html', '.css', '.exe', '.dmg', '.apk', '.iso'
          ];
          for (let i = 0; i < nonImgExts.length; i++) {
            if (pathPart.endsWith(nonImgExts[i])) return true;
          }
          return false;
        };

        const looksLikeImageUrl = (raw) => {
          if (!raw || typeof raw !== 'string') return false;
          if (isExcludedImageUrl(raw)) return false;
          const lower = raw.trim().toLowerCase();
          const pathPart = lower.split('?')[0].split('#')[0];
          const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg'];
          for (let i = 0; i < imgExts.length; i++) {
            if (pathPart.endsWith(imgExts[i])) return true;
          }
          if (
            lower.indexOf('format=webp') >= 0 ||
            lower.indexOf('format=png') >= 0 ||
            lower.indexOf('format=jpeg') >= 0 ||
            lower.indexOf('format=jpg') >= 0 ||
            lower.indexOf('format=gif') >= 0
          ) return true;
          return false;
        };

        const cleanImageUrl = (raw) => {
          if (!raw || typeof raw !== 'string') return '';
          let str = raw.trim();
          if (str.indexOf('//') === 0) str = 'https:' + str;
          if (isExcludedImageUrl(str)) return '';
          try {
            const u = new URL(str);
            if (
              u.hostname.indexOf('discordapp.net') >= 0 &&
              (u.searchParams.has('width') || u.searchParams.has('height'))
            ) {
              const w = parseInt(u.searchParams.get('width') || '0', 10);
              const h = parseInt(u.searchParams.get('height') || '0', 10);
              if ((w > 0 && w < 800) || (h > 0 && h < 600)) {
                u.searchParams.delete('width');
                u.searchParams.delete('height');
                return u.toString();
              }
            }
          } catch (_) {}
          return str;
        };

        const getImageDedupKey = (rawUrl) => {
          try {
            const u = new URL(rawUrl);
            if (
              u.hostname.indexOf('discordapp.com') >= 0 ||
              u.hostname.indexOf('discordapp.net') >= 0
            ) {
              return u.pathname.replace(/\\/+$/, '').toLowerCase();
            }
            return (u.origin + u.pathname).toLowerCase();
          } catch (_) {
            return String(rawUrl || '').split('?')[0].toLowerCase();
          }
        };

        const addImage = (rawUrl) => {
          const cleaned = cleanImageUrl(rawUrl);
          if (!cleaned) return;
          const key = getImageDedupKey(cleaned);
          if (!key || seenImages.has(key)) return;
          seenImages.add(key);
          images.push(cleaned);
        };

        const acc = li.querySelector('[id^="message-accessories-"]');

        // 1. Extract images from DOM inside message-accessories
        if (acc) {
          const imgs = acc.querySelectorAll('img');
          for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            if (!outsideReply(img)) continue;
            if (img.closest('[class*="reactions"], [class*="reaction_"], [class*="embedAuthor"], [class*="embedFooter"], [class*="embedProvider"], [class*="poll"]')) continue;
            const imgCls = (typeof img.className === 'string' ? img.className : '').toLowerCase();
            if (
              imgCls.indexOf('emoji') >= 0 ||
              imgCls.indexOf('avatar') >= 0 ||
              imgCls.indexOf('authoricon') >= 0 ||
              imgCls.indexOf('footericon') >= 0 ||
              imgCls.indexOf('roleicon') >= 0 ||
              imgCls.indexOf('guildicon') >= 0 ||
              imgCls.indexOf('channelicon') >= 0 ||
              imgCls.indexOf('badge') >= 0
            ) continue;
            const inMediaWrapper = !!img.closest('[class*="imageWrapper"], [class*="imageContainer"], [data-type="image"], [class*="embedImage"], [class*="embedThumbnail"], [class*="embedMedia"], [class*="embedGallery"], [class*="mosaicItem"], [class*="sticker"], [data-type="sticker"]');
            if (!inMediaWrapper && imgCls.indexOf('icon') >= 0) continue;

            const rawSrc = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-safe-src') || '';
            addImage(rawSrc);
          }

          const wrappers = acc.querySelectorAll('[class*="imageWrapper"], [class*="imageContainer"], [data-type="image"], [class*="embedImage"], [class*="embedThumbnail"], [class*="embedMedia"], [class*="mosaicItem"]');
          for (let i = 0; i < wrappers.length; i++) {
            const w = wrappers[i];
            if (!outsideReply(w)) continue;
            if (w.closest('[class*="reactions"], [class*="embedAuthor"], [class*="embedFooter"]')) continue;
            if (w.querySelector('video')) continue;

            const safeSrc = w.getAttribute('data-safe-src') || '';
            if (safeSrc) addImage(safeSrc);

            const links = w.tagName.toLowerCase() === 'a' ? [w] : Array.from(w.querySelectorAll('a[href]'));
            for (let j = 0; j < links.length; j++) {
              const href = links[j].getAttribute('href') || links[j].href || '';
              const linkCls = (typeof links[j].className === 'string' ? links[j].className : '');
              if ((linkCls.indexOf('originalLink') >= 0 || looksLikeImageUrl(href)) && looksLikeImageUrl(href)) {
                addImage(href);
              }
            }
          }
        }

        // 2. Supplement from Discord's React Fiber message state (covers offscreen / lazy-loaded images)
        try {
          const findReactMessage = (rootEl, targetMsgId) => {
            const candidates = [rootEl, rootEl && rootEl.firstElementChild, acc].filter(Boolean);
            for (let c = 0; c < candidates.length; c++) {
              const el = candidates[c];
              const keys = Object.keys(el);
              let fiberKey = '';
              for (let k = 0; k < keys.length; k++) {
                if (keys[k].indexOf('__reactFiber$') === 0 || keys[k].indexOf('__reactInternalInstance$') === 0) {
                  fiberKey = keys[k];
                  break;
                }
              }
              if (!fiberKey) continue;
              let fiber = el[fiberKey];
              for (let depth = 0; fiber && depth < 15; depth++) {
                const p = fiber.memoizedProps;
                if (p && typeof p === 'object') {
                  const msg = p.message || (p.children && p.children.props && p.children.props.message);
                  if (msg && typeof msg === 'object' && String(msg.id || '') === String(targetMsgId)) {
                    return msg;
                  }
                }
                fiber = fiber.return;
              }
            }
            return null;
          };

          const collectFromMessageRecord = (msgObj) => {
            if (!msgObj || typeof msgObj !== 'object') return;
            const atts = Array.isArray(msgObj.attachments) ? msgObj.attachments : [];
            for (let i = 0; i < atts.length; i++) {
              const a = atts[i];
              if (!a || typeof a !== 'object') continue;
              const ct = String(a.content_type || a.contentType || '').toLowerCase();
              const u = a.proxy_url || a.proxyUrl || a.url || '';
              if (ct.indexOf('video/') === 0 || ct.indexOf('audio/') === 0) continue;
              if (ct.indexOf('image/') === 0 || looksLikeImageUrl(u) || looksLikeImageUrl(a.filename || '')) {
                addImage(u);
              }
            }

            const embeds = Array.isArray(msgObj.embeds) ? msgObj.embeds : [];
            for (let i = 0; i < embeds.length; i++) {
              const emb = embeds[i];
              if (!emb || typeof emb !== 'object') continue;
              if (emb.image && typeof emb.image === 'object') {
                addImage(emb.image.proxyURL || emb.image.proxy_url || emb.image.url || '');
              }
              if (Array.isArray(emb.images)) {
                for (let j = 0; j < emb.images.length; j++) {
                  const im = emb.images[j];
                  if (im && typeof im === 'object') {
                    addImage(im.proxyURL || im.proxy_url || im.url || '');
                  }
                }
              }
              if (emb.thumbnail && typeof emb.thumbnail === 'object') {
                const embType = String(emb.type || '').toLowerCase();
                if (!emb.image || embType === 'image' || embType === 'gifv') {
                  addImage(emb.thumbnail.proxyURL || emb.thumbnail.proxy_url || emb.thumbnail.url || '');
                }
              }
            }

            const stickers = Array.isArray(msgObj.stickerItems)
              ? msgObj.stickerItems
              : (Array.isArray(msgObj.stickers) ? msgObj.stickers : []);
            for (let i = 0; i < stickers.length; i++) {
              const st = stickers[i];
              if (st && st.id && st.format_type !== 3) {
                const ext = st.format_type === 4 ? 'gif' : 'png';
                addImage('https://media.discordapp.net/stickers/' + st.id + '.' + ext + '?size=320');
              }
            }

            const snapshots = Array.isArray(msgObj.messageSnapshots) ? msgObj.messageSnapshots : [];
            for (let i = 0; i < snapshots.length; i++) {
              const snap = snapshots[i];
              if (snap && snap.message) {
                collectFromMessageRecord(snap.message);
              }
            }
          };

          const reactMsg = findReactMessage(li, messageId);
          if (reactMsg) collectFromMessageRecord(reactMsg);
        } catch (_) {}

        // Non-image attachments / embeds are summarized as chips.
        const media = [];
        if (acc) {
          if (acc.querySelector('video')) media.push('视频');
          if (images.length === 0 && acc.querySelector('[class*="imageWrapper"], [class*="imageContainer"], [data-type="image"]')) {
            media.push('图片');
          }
          if (acc.querySelector('[class*="embedFull"], [class*="embedWrapper"], article[class*="embed"]')) {
            const embedEl = acc.querySelector('[class*="embedFull"], [class*="embedWrapper"], article[class*="embed"]');
            const hasEmbedText = embedEl && (embedEl.querySelector('[class*="embedTitle"], [class*="embedDescription"], [class*="embedField"]') || (embedEl.textContent || '').trim().length > 0);
            if (hasEmbedText || images.length === 0) {
              media.push('嵌入卡片');
            }
          }
          const fileAtts = acc.querySelectorAll('[class*="attachment"], a[href*="cdn.discordapp.com/attachments"]');
          let hasNonImageAttachment = false;
          for (let i = 0; i < fileAtts.length; i++) {
            const el = fileAtts[i];
            if (el.closest('[class*="imageWrapper"], [class*="imageContainer"], [data-type="image"]')) continue;
            const href = el.getAttribute('href') || '';
            if (href && looksLikeImageUrl(href)) continue;
            hasNonImageAttachment = true;
            break;
          }
          if (hasNonImageAttachment) media.push('附件');
        }
        const attachments = media.filter((m, i) => media.indexOf(m) === i);

        if (!text && images.length === 0 && attachments.length === 0 && !replyText) continue;

        items.push({
          id: messageId,
          text: text,
          datetime: datetime,
          displayName: author,
          isBot: isBot,
          avatarUrl: avatar,
          isEdited: isEdited,
          replyAuthor: replyAuthor,
          replyText: replyText,
          images: images,
          attachments: attachments
        });
      }

      /* ---- Channel / guild identity ---- */

      function cleanSingleLineText(str) {
        return String(str || '')
          .split(/[\\r\\n]+/)[0]
          .replace(/[\\r\\n\\t]+/g, ' ')
          .trim();
      }

      let channelName = '';
      let guildName = '';

      // 1. Guild name from sidebar header or rail (Server Name)
      try {
        const guildHeader = document.querySelector('[class*="sidebar"] header [class*="name"], [class*="guildHeader"] [class*="name"], header[class*="header"] [class*="name"]');
        if (guildHeader && guildHeader.innerText) {
          guildName = guildHeader.innerText.trim();
        }
        if (!guildName && GUILD_ID && GUILD_ID !== '@me') {
          const guildItem = document.querySelector('div[data-list-item-id="guildsnav___' + GUILD_ID + '"]');
          if (guildItem) {
            guildName = (guildItem.getAttribute('aria-label') || '').trim();
          }
        }
      } catch (_) {}

      // 2. Channel name from active sidebar link
      try {
        const activeLink = document.querySelector(
          '[data-list-item-id="channels___' + CHANNEL_ID + '"], ' +
          'a[href*="/channels/' + GUILD_ID + '/' + CHANNEL_ID + '"], ' +
          'a[href$="/' + CHANNEL_ID + '"]'
        );
        if (activeLink) {
          const nameEl = activeLink.querySelector('[class*="channelName"], [class*="name"]');
          if (nameEl && nameEl.innerText && nameEl.innerText.trim()) {
            channelName = nameEl.innerText.trim();
          } else {
            const aria = activeLink.getAttribute('aria-label') || '';
            if (aria) {
              channelName = aria.split(/[,，(（]/)[0].trim();
            }
          }
        }
      } catch (_) {}

      // 3. Channel name from chat header
      if (!channelName) {
        try {
          const headerEl = document.querySelector('[class*="chat"] header [role="heading"], [class*="chat"] [class*="title"] [role="heading"], section[class*="title"] [role="heading"], [class*="channelName"]');
          let rawHeader = '';
          if (headerEl && headerEl.innerText) {
            rawHeader = headerEl.innerText.trim();
          } else {
            const headerH1 = document.querySelector('[class*="title"] h1, h1[class*="title"]');
            if (headerH1 && headerH1.innerText) rawHeader = headerH1.innerText.trim();
          }

          if (rawHeader) {
            if (rawHeader.includes(':') || rawHeader.includes('：')) {
              const cparts = rawHeader.split(/[:：]/);
              const p0 = cparts[0].replace(/^[#@]+/, '').trim();
              const p1 = cparts.slice(1).join(':').replace(/^[#@]+/, '').trim();
              if (p1) {
                channelName = p1;
                if (!guildName && p0) guildName = p0;
              } else {
                channelName = p0;
              }
            } else if (/[\\r\\n]/.test(rawHeader)) {
              const lines = rawHeader.split(/[\\r\\n]+/).map(s => s.replace(/^[#@]+/, '').trim()).filter(Boolean);
              if (lines.length >= 2) {
                channelName = lines[lines.length - 1];
                if (!guildName) guildName = lines[0];
              } else if (lines.length === 1) {
                channelName = lines[0];
              }
            } else {
              channelName = rawHeader;
            }
          }
        } catch (_) {}
      }

      // 4. Fallback / supplement from document.title
      let rawDocTitle = (document.title || '').trim();
      rawDocTitle = rawDocTitle.replace(/^\\s*\\(\\d+\\+?\\)\\s*/, '').trim();
      rawDocTitle = rawDocTitle.replace(/\\s*[-|]\\s*Discord$/i, '').trim();

      // If guildName is known, remove it from rawDocTitle to isolate channel name
      if (guildName) {
        const escapedG = guildName.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
        const strippedTitle = rawDocTitle
          .replace(new RegExp('\\\\s*[:|]\\\\s*' + escapedG + '$', 'i'), '')
          .replace(new RegExp('^' + escapedG + '\\\\s*[:|]\\\\s*', 'i'), '')
          .trim();
        if (strippedTitle && !channelName) {
          channelName = strippedTitle;
        }
      }

      if (!channelName) {
        if (rawDocTitle.includes(':') || rawDocTitle.includes('：')) {
          const cparts = rawDocTitle.split(/[:：]/);
          channelName = cparts.slice(1).join(':').trim();
          if (!guildName) guildName = cparts[0].trim();
        } else {
          channelName = rawDocTitle;
        }
      }

      // Clean channel name: take first line, strip leading #/@, trailing colons/punctuation, accessibility suffixes
      channelName = cleanSingleLineText(channelName);
      channelName = channelName
        .replace(/^[#@\s]+/, '')
        .split(/[,，(（]/)[0]
        .replace(/[:：\\s]+$/, '')
        .trim();

      // Clean guild name
      guildName = cleanSingleLineText(guildName);
      guildName = guildName.replace(/\\s*[-|]\\s*Discord$/i, '').trim();

      // Prevent duplicate display if guild name equals channel name
      if (guildName.toLowerCase() === channelName.toLowerCase()) {
        guildName = '';
      }

      // Guild icons are served from /icons/<guildId>/<hash>, which makes them
      // trivially identifiable without depending on any class name.
      let iconUrl = '';
      const iconImg = document.querySelector('img[src*="/icons/' + GUILD_ID + '/"]');
      if (iconImg) {
        iconUrl = iconImg.src || '';
      } else if (GUILD_ID === '@me') {
        const dmAvatar = document.querySelector('[class*="privateChannels"] [class*="selected"] img, [class*="chat"] img[class*="avatar"]');
        if (dmAvatar) iconUrl = dmAvatar.src || '';
      }

      return {
        success: true,
        items: items,
        channelName: channelName,
        guildName: guildName,
        iconUrl: iconUrl
      };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()
  `;
}

/* ----------------------------------------------------------------
   Navigation
   ---------------------------------------------------------------- */

async function runScript(wv, script) {
  try {
    return await executeWebviewScript(wv, script, 8000);
  } catch (e) {
    // Thrown while the page is mid-navigation or timed out; the caller just polls again.
    return null;
  }
}

/**
 * Brings the shared client to `channelId`, booting or reloading it as needed.
 * Resolves to { ok } or { ok: false, error }.
 */
async function ensureDiscordChannel(wv, guildId, channelId, onProgress) {
  if (!(await canReachHost('discord.com'))) {
    return { ok: false, offline: true, error: t('discord.offlineConnectError') };
  }

  await waitForWebviewReady(wv);

  let currentUrl = '';
  try {
    currentUrl = wv.getURL() || '';
  } catch (e) {}

  const targetUrl = buildDiscordChannelUrl(guildId, channelId);
  const isOnDiscord = currentUrl.indexOf('discord.com/') > 0 && currentUrl.indexOf('/login') < 0;

  let timeout = SWITCH_TIMEOUT_MS;

  if (!isOnDiscord) {
    if (onProgress) onProgress(t('discord.bootingClient'));
    timeout = BOOT_TIMEOUT_MS;
    const loadRes = await loadWebviewTarget(wv, targetUrl);
    if (loadRes && loadRes.offline) {
      return { ok: false, offline: true, error: t('discord.offlineConnectError') };
    }
  } else {
    // Check if the webview is already showing this EXACT channel and is ready
    const probe = await runScript(wv, buildReadinessScript(channelId));
    if (probe && probe.state === 'ready') {
      return { ok: true };
    }

    let inAppSwitched = false;
    const sameGuild = currentUrl.indexOf(`/channels/${guildId}/`) >= 0;
    if (sameGuild) {
      if (onProgress) onProgress(t('discord.switchingChannel'));
      const clickRes = await runScript(wv, buildInAppChannelClickScript(guildId, channelId));
      if (clickRes && clickRes.clicked) {
        const quickDeadline = Date.now() + 3000;
        while (Date.now() < quickDeadline) {
          if (!isNetworkOnline()) {
            return { ok: false, offline: true, error: t('discord.offlineConnectError') };
          }
          const quickProbe = await runScript(wv, buildReadinessScript(channelId));
          if (quickProbe && quickProbe.state === 'ready') {
            inAppSwitched = true;
            return { ok: true };
          }
          await sleep(300);
        }
      }
    }

    if (!inAppSwitched) {
      if (onProgress) onProgress(t('discord.loadingChannel'));
      timeout = BOOT_TIMEOUT_MS;
      const loadRes = await loadWebviewTarget(wv, targetUrl);
      if (loadRes && loadRes.offline) {
        return { ok: false, offline: true, error: t('discord.offlineConnectError') };
      }
    }
  }

  const deadline = Date.now() + timeout;
  let lastState = '';

  while (Date.now() < deadline) {
    if (!isNetworkOnline()) {
      return { ok: false, offline: true, error: t('discord.offlineConnectError') };
    }
    const probe = await runScript(wv, buildReadinessScript(channelId));
    if (probe) {
      lastState = probe.state;
      if (probe.state === 'ready') return { ok: true };
      if (probe.state === 'login') {
        saveDiscordLoggedIn(false);
        return { ok: false, error: t('discord.notLoggedInError') };
      }
    }
    await sleep(500);
  }

  if (lastState === 'switching' || lastState === 'booting') {
    return { ok: false, error: t('discord.switchTimeoutError') };
  }
  return { ok: false, error: t('discord.loadTimeoutError') };
}

/** Scrolls to the newest message, skipping any unread backlog. */
async function jumpToPresent(wv) {
  for (let i = 0; i < 6; i++) {
    const res = await runScript(wv, JUMP_TO_PRESENT_SCRIPT);
    await sleep(res && res.jumped ? 900 : 350);
    if (res && res.atBottom && !res.jumped) return;
  }
}

/* ----------------------------------------------------------------
   Slot fetching
   ---------------------------------------------------------------- */

function toSlotMessage(item, guildId, channelId) {
  return {
    ...item,
    text: stripDiscordEditedText(item.text),
    replyText: stripDiscordEditedText(item.replyText),
    source: SOURCE_DISCORD,
    url: buildDiscordMessageUrl(guildId, channelId, item.id),
    time: item.datetime
  };
}

async function fetchDiscordSlot(slotIndex, { isBackground = false } = {}, { slots, bgWebviewsContainer }) {
  const slot = slots[slotIndex];
  if (!slot || slot.isFetching) return { ok: false };

  const rawInput = slot.handleInput.value.trim();
  const parsed = parseDiscordChannelUrl(rawInput);
  if (!parsed) {
    if (!isBackground) showSlotError(slot, t('discord.invalidUrlError'));
    return { ok: false };
  }

  const { guildId, channelId } = parsed;
  saveHandles(slots);

  const prevKey = getCanonicalTargetKey(slot.monitoredHandle || '');
  const currKey = getCanonicalTargetKey(rawInput, SOURCE_DISCORD);
  if (prevKey !== currKey) {
    archiveSlotScrapedData(slot);
    const restored = restoreSlotFromTargetCache(slot, rawInput, slots);
    if (!restored) {
      slot.loadedPosts = [];
      resetSlotReadTracking(slot);
      slot.monitoredHandle = rawInput;
      updateSlotAvatar(slot, null);
    }
  } else if (!Array.isArray(slot.loadedPosts) || slot.loadedPosts.length === 0) {
    restoreSlotFromTargetCache(slot, rawInput, slots);
  }

  ensureSlotReadTracking(slot);

  const hasExisting = (
    getCanonicalTargetKey(slot.monitoredHandle || '') === currKey &&
    Array.isArray(slot.loadedPosts) &&
    slot.loadedPosts.length > 0 &&
    slot.loadedPosts.every(m => {
      const p = parseDiscordChannelUrl(m.url);
      return !p || !p.channelId || p.channelId === channelId;
    })
  );

  // Skip fetching altogether when the network is disconnected
  if (!(await canReachHost('discord.com'))) {
    if (!isBackground) {
      if (!hasExisting) {
        showSlotError(slot, t('discord.offlineReadError'));
      }
      showToast(t('discord.offlinePausedToast'), 'warning', 2500);
    }
    return { ok: false, offline: true };
  }

  slot.isFetching = true;
  if (slot.card) slot.card.classList.add('is-fetching');

  if (!hasExisting) {
    showSlotLoading(slot, t('discord.readingChannel'));
  }

  const setProgress = (text) => {
    if (!hasExisting && slot.loadingText) {
      slot.loadingText.innerText = text;
    }
  };

  let slotOffline = false;
  try {
    await withDiscordLock(async () => {
      if (!(await canReachHost('discord.com'))) {
        slotOffline = true;
        if (!isBackground && !hasExisting) {
          showSlotError(slot, t('discord.offlineReadError'));
        }
        return;
      }

      const wv = getOrCreateDiscordWebview(bgWebviewsContainer);

      const nav = await ensureDiscordChannel(wv, guildId, channelId, setProgress);
      if (!nav.ok) {
        if (nav.offline) {
          slotOffline = true;
          if (!isBackground && !hasExisting) {
            showSlotError(slot, nav.error);
          }
          return;
        }
        if (!hasExisting) {
          showSlotError(slot, nav.error);
        } else if (!isBackground) {
          showToast(nav.error, 'warning', 3000);
        } else {
          console.warn(`[Discord] ${rawInput}: ${nav.error}`);
        }
        return;
      }

      saveDiscordLoggedIn(true);
      setProgress(t('discord.locatingLatest'));
      await jumpToPresent(wv);
      await sleep(400);

      // Snapshot existing messages after lock acquisition & navigation so we see
      // any read-state updates the user made while waiting.
      ensureSlotReadTracking(slot);
      const existingMessages = hasExisting && Array.isArray(slot.loadedPosts) ? slot.loadedPosts : [];
      if (hasExisting) {
        recordSlotReadPosts(slot, existingMessages);
      }
      const existingKeys = new Set(existingMessages.map(m => getPostKey(m)).filter(Boolean));
      for (const k of slot.knownKeys) existingKeys.add(k);
      for (const k of slot.readKeys) existingKeys.add(k);
      const backfilledByKey = new Map();

      const collected = [];
      const seen = new Set();
      let meta = { channelName: '', guildName: '', iconUrl: '' };
      let reachedBoundary = false;
      // Only walk backwards through history when the channel might have moved
      // more messages than one screen holds since the last crawl.
      const maxPasses = hasExisting ? 6 : 3;

      for (let pass = 0; pass < maxPasses; pass++) {
        const result = await runScript(wv, buildDiscordExtractionScript(guildId, channelId));

        if (result && result.error === 'NOT_LOGGED_IN') {
          saveDiscordLoggedIn(false);
          const loginErrMsg = t('discord.notLoggedInError');
          if (!hasExisting) {
            showSlotError(slot, loginErrMsg);
          } else if (!isBackground) {
            showToast(loginErrMsg, 'warning', 3000);
          }
          return;
        }
        if (result && result.error) {
          const failMsg = t('discord.scrapeFailedError', { error: result.error });
          if (!hasExisting) {
            showSlotError(slot, failMsg);
          } else if (!isBackground) {
            showToast(failMsg, 'warning', 3000);
          }
          return;
        }

        if (result && result.success) {
          if (result.channelName) meta.channelName = result.channelName;
          if (result.guildName) meta.guildName = result.guildName;
          if (result.iconUrl) meta.iconUrl = result.iconUrl;

          // Record fresh fields for any already-cached messages visible on screen
          for (let i = 0; i < result.items.length; i++) {
            const freshMsg = toSlotMessage(result.items[i], guildId, channelId);
            const freshKey = getPostKey(freshMsg);
            if (freshKey && existingKeys.has(freshKey)) {
              backfilledByKey.set(freshKey, freshMsg);
            }
          }

          // The list is in chronological order; walking it backwards means we
          // meet the previous crawl's newest message as early as possible.
          for (let i = result.items.length - 1; i >= 0; i--) {
            const msg = toSlotMessage(result.items[i], guildId, channelId);
            const key = getPostKey(msg);
            if (seen.has(key)) continue;
            seen.add(key);

            if (existingKeys.has(key)) {
              reachedBoundary = true;
              break;
            }
            msg.isUnread = hasExisting ? shouldMarkScrapedItemUnread(slot, msg) : true;
            collected.push(msg);
          }
        }

        if (reachedBoundary || !hasExisting) break;
        if (collected.length >= MAX_DISCORD_MESSAGES) break;

        setProgress(t('discord.scrollingHistory', { count: collected.length }));
        const up = await runScript(wv, SCROLL_UP_SCRIPT);
        if (!up || !up.ok || up.atTop) break;
        await sleep(600);
      }

      // Leave the channel pinned to the newest message for the next crawl.
      if (hasExisting && collected.length > 0) await jumpToPresent(wv);

      // Re-read the live slot messages right before merging/rendering so any
      // mark-as-read interactions during scraping are strictly preserved.
      const liveExistingMessages = (
        hasExisting &&
        getCanonicalTargetKey(slot.monitoredHandle || '') === currKey &&
        Array.isArray(slot.loadedPosts) &&
        slot.loadedPosts.length > 0
      ) ? slot.loadedPosts : existingMessages;

      let backfillChanged = false;
      if (hasExisting) {
        liveExistingMessages.forEach(m => {
          if (!Array.isArray(m.images)) m.images = [];
          if (typeof m.text === 'string') m.text = stripDiscordEditedText(m.text);
          if (typeof m.replyText === 'string') m.replyText = stripDiscordEditedText(m.replyText);

          const freshMsg = backfilledByKey.get(getPostKey(m));
          if (freshMsg) {
            if (freshMsg.text && freshMsg.text !== m.text) {
              m.text = freshMsg.text;
              backfillChanged = true;
            }
            if (freshMsg.replyText && freshMsg.replyText !== m.replyText) {
              m.replyText = freshMsg.replyText;
              backfillChanged = true;
            }
            if (Array.isArray(freshMsg.images) && freshMsg.images.length > 0) {
              if (JSON.stringify(m.images) !== JSON.stringify(freshMsg.images)) {
                m.images = freshMsg.images;
                backfillChanged = true;
              }
            }
            if (Array.isArray(freshMsg.attachments)) {
              if (JSON.stringify(m.attachments || []) !== JSON.stringify(freshMsg.attachments)) {
                m.attachments = freshMsg.attachments;
                backfillChanged = true;
              }
            }
            if (freshMsg.avatarUrl && !m.avatarUrl) {
              m.avatarUrl = freshMsg.avatarUrl;
              backfillChanged = true;
            }
          }
        });
        recordSlotReadPosts(slot, liveExistingMessages);
      }

      slot.monitoredHandle = rawInput;
      slot.source = SOURCE_DISCORD;
      slot.lastFetchedAt = Date.now();
      saveLastFetchTimeDiscord(slot.lastFetchedAt);
      updateSlotFetchTimeUI(slot, slot.lastFetchedAt);

      const cleanChan = String(meta.channelName || '')
        .split(/[\r\n]+/)[0]
        .replace(/^[#@\s]+/, '')
        .split(/[,，(（]/)[0]
        .replace(/[:：\s]+$/, '')
        .trim();
      const channelLabel = cleanChan
        ? `#${cleanChan}`
        : normalizeDiscordChannelFallback(slot.sourceTitle || t('slot.defaultDiscordChannel'));

      let guildLabel = String(meta.guildName || '')
        .split(/[\r\n]+/)[0]
        .replace(/\s*[-|]\s*Discord$/i, '')
        .trim();
      if (guildLabel.toLowerCase() === cleanChan.toLowerCase()) {
        guildLabel = '';
      }
      if (!guildLabel && slot.sourceSubtitle) {
        guildLabel = slot.sourceSubtitle;
      }

      const renderMeta = {
        source: SOURCE_DISCORD,
        title: channelLabel,
        subtitle: guildLabel
      };

      if (collected.length === 0 && hasExisting) {
        if (!isBackground) showToast(t('discord.upToDateToast', { channelLabel }), 'info', 2000);
        if (backfillChanged) {
          renderSlotPosts(
            slot,
            processAndSortPosts(liveExistingMessages),
            rawInput,
            meta.iconUrl || null,
            slots,
            renderMeta
          );
        } else {
          if (meta.iconUrl) updateSlotAvatar(slot, meta.iconUrl);
          updateSlotHeaderMeta(slot, renderMeta);
          persistSlot(slot, slots);
        }
        return;
      }

      if (collected.length === 0) {
        showSlotError(slot, t('discord.noMessagesError'));
        return;
      }

      const newUnreadItems = collected.filter(m => m.isUnread !== false);
      if (hasExisting && newUnreadItems.length > 0) {
        showToast(t('discord.newMessagesToast', { channelLabel, count: newUnreadItems.length }), 'success', 2500);
      }

      const merged = processAndSortPosts([...liveExistingMessages, ...collected]);
      renderSlotPosts(
        slot,
        merged.slice(-Math.max(MAX_DISCORD_MESSAGES, liveExistingMessages.length)),
        rawInput,
        meta.iconUrl || null,
        slots,
        renderMeta
      );

      if (hasExisting && newUnreadItems.length > 0) {
        notifySlotNewMessages(slot, newUnreadItems);
      }
    });
  } catch (err) {
    if (!hasExisting) {
      showSlotError(slot, t('discord.exceptionError', { message: err.message }));
    } else if (!isBackground) {
      showToast(t('discord.exceptionToast', { message: err.message }), 'warning', 3000);
    } else {
      console.warn(`[Discord] Exception for ${rawInput}:`, err);
    }
  } finally {
    slot.isFetching = false;
    if (slot.card) slot.card.classList.remove('is-fetching');
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
  return { ok: !slotOffline, offline: slotOffline };
}

module.exports = {
  getOrCreateDiscordWebview,
  applyDiscordSoundSetting,
  ensureDiscordChannel,
  buildReadinessScript,
  buildDiscordExtractionScript,
  fetchDiscordSlot
};
