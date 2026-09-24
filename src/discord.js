const {
  DISCORD_PARTITION,
  DISCORD_WEBVIEW_ID,
  MAX_DISCORD_MESSAGES
} = require('./constants');
const { sleep, showToast } = require('./utils');
const { processAndSortTweets, getTweetKey } = require('./tweet');
const { saveHandles, saveLastFetchTime, saveLastFetchTimeDiscord, saveDiscordLoggedIn } = require('./storage');
const { waitForWebviewReady, loadWebviewTarget } = require('./webview');
const {
  parseDiscordChannelUrl,
  buildDiscordChannelUrl,
  buildDiscordMessageUrl,
  SOURCE_DISCORD
} = require('./source');
const {
  updateSlotAvatar,
  updateSlotFetchTimeUI,
  showSlotLoading,
  showSlotError,
  renderSlotTweets
} = require('./slot');

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

    if (container) container.appendChild(wv);
  }
  return wv;
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
      if (rows.length === 0) return { state: 'empty-list' };

      return { state: 'ready', count: rows.length };
    } catch (e) {
      return { state: 'error', error: String(e && e.message || e) };
    }
  })()
  `;
}

/**
 * Attempts an in-app channel switch. Discord's router is driven by the history
 * library, which listens for `popstate` on window, so pushState + a synthetic
 * popstate navigates without tearing down and re-booting the whole client.
 */
function buildSpaNavigateScript(guildId, channelId) {
  return `
  (() => {
    try {
      const target = '/channels/' + ${JSON.stringify(String(guildId))} + '/' + ${JSON.stringify(String(channelId))};
      if (location.pathname === target) return { ok: true, noop: true };
      history.pushState({}, '', target);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      return { ok: true, path: location.pathname };
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
      const bar = document.querySelector('[class*="jumpToPresentBar"] button, [class*="jumpToPresentBar"] [role="button"]');
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
        return out.replace(/\\n{3,}/g, '\\n\\n').trim();
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

        // Attachments / embeds cannot be shown inline, so they are summarized.
        const media = [];
        const acc = li.querySelector('[id^="message-accessories-"]');
        if (acc) {
          if (acc.querySelector('video')) media.push('视频');
          if (acc.querySelector('[class*="imageWrapper"], [class*="imageContainer"], [data-type="image"]')) media.push('图片');
          if (acc.querySelector('[class*="embedFull"], [class*="embedWrapper"], article[class*="embed"]')) media.push('嵌入卡片');
          if (acc.querySelector('[class*="attachment"], a[href*="cdn.discordapp.com/attachments"]')) media.push('附件');
        }
        const attachments = media.filter((m, i) => media.indexOf(m) === i);

        if (!text && attachments.length === 0 && !replyText) continue;

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
          const aria = activeLink.getAttribute('aria-label') || '';
          const cleanAria = aria.replace(/\\s*\\([^)]*(?:channel|频道)[^)]*\\)/i, '').trim();
          if (cleanAria) {
            channelName = cleanAria;
          } else {
            const nameEl = activeLink.querySelector('[class*="name"]');
            if (nameEl && nameEl.innerText) channelName = nameEl.innerText.trim();
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

      // Clean channel name: take first line, strip leading #/@, trailing colons/punctuation
      channelName = cleanSingleLineText(channelName);
      channelName = channelName.replace(/^[#@]+/, '').replace(/[:：\\s]+$/, '').trim();

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
    return await wv.executeJavaScript(script);
  } catch (e) {
    // Thrown while the page is mid-navigation; the caller just polls again.
    return null;
  }
}

/**
 * Brings the shared client to `channelId`, booting or reloading it as needed.
 * Resolves to { ok } or { ok: false, error }.
 */
async function ensureDiscordChannel(wv, guildId, channelId, onProgress) {
  await waitForWebviewReady(wv);

  let currentUrl = '';
  try {
    currentUrl = wv.getURL() || '';
  } catch (e) {}

  const targetPath = `/channels/${guildId}/${channelId}`;
  const isOnDiscord = currentUrl.indexOf('discord.com/') > 0 && currentUrl.indexOf('/login') < 0;

  let timeout = SWITCH_TIMEOUT_MS;

  if (!isOnDiscord) {
    if (onProgress) onProgress('正在启动 Discord 客户端...');
    timeout = BOOT_TIMEOUT_MS;
    await loadWebviewTarget(wv, buildDiscordChannelUrl(guildId, channelId));
  } else if (currentUrl.indexOf(targetPath) < 0) {
    if (onProgress) onProgress('正在切换频道...');
    const res = await runScript(wv, buildSpaNavigateScript(guildId, channelId));
    if (!res || !res.ok) {
      // The in-app router refused; fall back to a hard reload.
      timeout = BOOT_TIMEOUT_MS;
      await loadWebviewTarget(wv, buildDiscordChannelUrl(guildId, channelId));
    }
  }

  const deadline = Date.now() + timeout;
  let spaRetried = false;
  let lastState = '';

  while (Date.now() < deadline) {
    const probe = await runScript(wv, buildReadinessScript(channelId));
    if (probe) {
      lastState = probe.state;
      if (probe.state === 'ready') return { ok: true };
      if (probe.state === 'login') {
        saveDiscordLoggedIn(false);
        return { ok: false, error: '尚未登录 Discord，请点击右上角【登录 Discord】完成登录' };
      }
      // Booted, but the router never moved: nudge it once more before reloading.
      if (probe.state === 'switching' && !spaRetried && Date.now() > deadline - timeout + 5000) {
        spaRetried = true;
        await runScript(wv, buildSpaNavigateScript(guildId, channelId));
      }
    }
    await sleep(500);
  }

  if (lastState === 'switching' || lastState === 'booting') {
    return { ok: false, error: '切换频道超时，请确认该频道仍然存在且账号有访问权限' };
  }
  return { ok: false, error: '加载频道消息超时，可能没有该频道的访问权限，或网络较慢' };
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
    source: SOURCE_DISCORD,
    url: buildDiscordMessageUrl(guildId, channelId, item.id),
    time: item.datetime
  };
}

async function fetchDiscordSlot(slotIndex, { isBackground = false } = {}, { slots, bgWebviewsContainer }) {
  const slot = slots[slotIndex];
  if (!slot || slot.isFetching) return;

  const rawInput = slot.handleInput.value.trim();
  const parsed = parseDiscordChannelUrl(rawInput);
  if (!parsed) {
    if (!isBackground) showSlotError(slot, '无法解析 Discord 频道链接');
    return;
  }

  const { guildId, channelId } = parsed;
  saveHandles(slots);

  slot.isFetching = true;
  slot.btnFetch.disabled = true;
  slot.btnFetch.classList.add('fetching');
  slot.btnFetch.title = '正在抓取 Discord 消息...';

  const hasExisting = (
    slot.monitoredHandle === rawInput &&
    Array.isArray(slot.loadedTweets) &&
    slot.loadedTweets.length > 0
  );
  const existingMessages = hasExisting ? slot.loadedTweets : [];
  const existingKeys = new Set(existingMessages.map(m => getTweetKey(m)));

  if (!isBackground || !hasExisting) {
    showSlotLoading(slot, '正在读取 Discord 频道...');
  }

  const setProgress = (text) => {
    if ((!isBackground || !hasExisting) && slot.loadingText) {
      slot.loadingText.innerText = text;
    }
  };

  try {
    await withDiscordLock(async () => {
      const wv = getOrCreateDiscordWebview(bgWebviewsContainer);

      const nav = await ensureDiscordChannel(wv, guildId, channelId, setProgress);
      if (!nav.ok) {
        if (!isBackground || !hasExisting) {
          showSlotError(slot, nav.error);
        } else {
          console.warn(`[Discord] ${rawInput}: ${nav.error}`);
        }
        return;
      }

      saveDiscordLoggedIn(true);
      setProgress('正在定位最新消息...');
      await jumpToPresent(wv);
      await sleep(400);

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
          if (!isBackground || !hasExisting) {
            showSlotError(slot, '尚未登录 Discord，请点击右上角【登录 Discord】完成登录');
          }
          return;
        }
        if (result && result.error) {
          if (!isBackground || !hasExisting) showSlotError(slot, `Discord 抓取失败: ${result.error}`);
          return;
        }

        if (result && result.success) {
          if (result.channelName) meta.channelName = result.channelName;
          if (result.guildName) meta.guildName = result.guildName;
          if (result.iconUrl) meta.iconUrl = result.iconUrl;

          // The list is in chronological order; walking it backwards means we
          // meet the previous crawl's newest message as early as possible.
          for (let i = result.items.length - 1; i >= 0; i--) {
            const msg = toSlotMessage(result.items[i], guildId, channelId);
            const key = getTweetKey(msg);
            if (seen.has(key)) continue;
            seen.add(key);

            if (existingKeys.has(key)) {
              reachedBoundary = true;
              break;
            }
            msg.isUnread = true;
            collected.push(msg);
          }
        }

        if (reachedBoundary || !hasExisting) break;
        if (collected.length >= MAX_DISCORD_MESSAGES) break;

        setProgress(`正在向上翻阅历史 (${collected.length})...`);
        const up = await runScript(wv, SCROLL_UP_SCRIPT);
        if (!up || !up.ok || up.atTop) break;
        await sleep(600);
      }

      // Leave the channel pinned to the newest message for the next crawl.
      if (hasExisting && collected.length > 0) await jumpToPresent(wv);

      slot.monitoredHandle = rawInput;
      slot.source = SOURCE_DISCORD;
      slot.lastFetchedAt = Date.now();
      saveLastFetchTime(slot.lastFetchedAt);
      saveLastFetchTimeDiscord(slot.lastFetchedAt);
      updateSlotFetchTimeUI(slot, slot.lastFetchedAt);

      const cleanChan = String(meta.channelName || '')
        .split(/[\r\n]+/)[0]
        .replace(/^[#@]+/, '')
        .replace(/[:：\s]+$/, '')
        .trim();
      const channelLabel = cleanChan ? `#${cleanChan}` : '#频道';

      let guildLabel = String(meta.guildName || '')
        .split(/[\r\n]+/)[0]
        .replace(/\s*[-|]\s*Discord$/i, '')
        .trim();
      if (guildLabel.toLowerCase() === cleanChan.toLowerCase()) {
        guildLabel = '';
      }

      const renderMeta = {
        source: SOURCE_DISCORD,
        title: channelLabel,
        subtitle: guildLabel
      };

      if (collected.length === 0 && hasExisting) {
        if (!isBackground) showToast(`${channelLabel} 已是最新，暂无新消息`, 'info', 2000);
        renderSlotTweets(
          slot,
          processAndSortTweets(existingMessages),
          rawInput,
          meta.iconUrl || null,
          slots,
          renderMeta
        );
        return;
      }

      if (collected.length === 0) {
        if (!isBackground || !hasExisting) {
          showSlotError(slot, '未读取到消息。请确认该频道有历史消息，且账号拥有查看权限。');
        }
        return;
      }

      if (hasExisting) {
        showToast(`${channelLabel} 抓取到 ${collected.length} 条新消息`, 'success', 2500);
      }

      const merged = processAndSortTweets([...collected, ...existingMessages]);
      renderSlotTweets(
        slot,
        merged.slice(-MAX_DISCORD_MESSAGES),
        rawInput,
        meta.iconUrl || null,
        slots,
        renderMeta
      );
    });
  } catch (err) {
    if (!isBackground || !hasExisting) {
      showSlotError(slot, `发生异常: ${err.message}`);
    } else {
      console.warn(`[Discord] Exception for ${rawInput}:`, err);
    }
  } finally {
    slot.isFetching = false;
    slot.btnFetch.disabled = false;
    slot.btnFetch.classList.remove('fetching');
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
}

module.exports = {
  getOrCreateDiscordWebview,
  ensureDiscordChannel,
  buildReadinessScript,
  buildDiscordExtractionScript,
  fetchDiscordSlot
};
