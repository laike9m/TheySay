const { BACKGROUND_FETCH_INTERVAL_MS } = require('./constants');
const { randomBetween, sleep, showToast } = require('./utils');
const { getTweetKey, processAndSortTweets } = require('./tweet');
const {
  saveHandles,
  getLastFetchTime,
  saveLastFetchTime,
  getLastFetchTimeTwitter,
  saveLastFetchTimeTwitter,
  getLastFetchTimeDiscord,
  saveLastFetchTimeDiscord,
  getTwitterIntervalMinutes,
  getDiscordIntervalMinutes
} = require('./storage');
const { getOrCreateSlotWebview, waitForWebviewReady, loadWebviewTarget } = require('./webview');
const {
  updateSlotAvatar,
  updateSlotFetchTimeUI,
  showSlotLoading,
  showSlotError,
  renderSlotTweets
} = require('./slot');
const { SOURCE_DISCORD, SOURCE_TWITTER, detectSourceType, normalizeTwitterHandle } = require('./source');
const { fetchDiscordSlot } = require('./discord');

function buildExtractionScript(handle) {
  const cleanHandle = String(handle || '').replace(/^@/, '').toLowerCase().trim();
  return `
  (() => {
    try {
      const targetHandle = ${JSON.stringify(cleanHandle)};
      const bodyText = document.body ? document.body.innerText : '';
      
      if (bodyText.includes("Rate limit exceeded") || bodyText.includes("超出频率限制")) {
        return { error: '已触碰 Twitter 频率限制 (Rate limit exceeded)，请稍候 10~15 分钟再试' };
      }
      if (document.querySelector('iframe[src*="arkose"]') || document.querySelector('iframe[src*="challenge"]') || bodyText.includes("Confirm you’re human") || bodyText.includes("请确认您是真人")) {
        return { error: 'Twitter 要求进行人机验证，请点击右上角【登录 X】在弹出窗口中手动完成验证' };
      }

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

      const allArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article'));
      const articles = allArticles.filter(a => !a.parentElement.closest('article'));
      if (!articles || articles.length === 0) {
        return { pending: true };
      }

      // Extract user profile avatar URL strictly matching targetHandle
      let avatarUrl = '';

      if (targetHandle) {
        // 1. Check profile header photo link: <a href="/handle/photo"> or <a href="/handle/photo?xxx">
        const photoImgs = Array.from(document.querySelectorAll('a[href*="/photo"] img'));
        for (const img of photoImgs) {
          const a = img.closest('a');
          const href = a ? (a.getAttribute('href') || '') : '';
          // Make sure it is the target user's profile photo (e.g. /sama/photo) and not inside a tweet
          if (href.toLowerCase().includes('/' + targetHandle + '/photo') && !img.closest('article')) {
            if (img.src && !img.src.includes('default_profile')) {
              avatarUrl = img.src;
              break;
            }
          }
        }

        // 2. Check profile avatar by alt="@handle" or alt="handle" (excluding sidebar and recommendations)
        if (!avatarUrl) {
          const profileImgs = Array.from(document.querySelectorAll('img[src*="profile_images"]'));
          for (const img of profileImgs) {
            if (img.closest('aside') || img.closest('[data-testid="sidebarColumn"]')) continue;
            const alt = (img.getAttribute('alt') || '').toLowerCase();
            if (alt === '@' + targetHandle || alt === targetHandle || alt.includes('@' + targetHandle)) {
              if (img.src && !img.src.includes('default_profile')) {
                avatarUrl = img.src;
                break;
              }
            }
          }
        }

        // 3. Check author's own tweet avatar: article where the avatar link specifically points to /handle
        if (!avatarUrl) {
          for (const article of articles) {
            const authorAvatarImg = article.querySelector(\`[data-testid="Tweet-User-Avatar"] a[href^="/\${targetHandle}" i] img, [data-testid="Tweet-User-Avatar"] a[href="/\${targetHandle}" i] img\`);
            if (authorAvatarImg && authorAvatarImg.src && !authorAvatarImg.src.includes('default_profile')) {
              avatarUrl = authorAvatarImg.src;
              break;
            }
          }
        }
      }

      // 4. Fallback: Generic profile header photo link (only in primaryColumn/header, NEVER in tweets or sidebar)
      if (!avatarUrl) {
        const headerImg = document.querySelector('header a[href$="/photo"] img, [data-testid="primaryColumn"] a[href$="/photo"] img, a[href$="/photo"] img');
        if (headerImg && !headerImg.closest('article') && !headerImg.closest('aside') && !headerImg.closest('[data-testid="sidebarColumn"]')) {
          if (headerImg.src && !headerImg.src.includes('default_profile')) {
            avatarUrl = headerImg.src;
          }
        }
      }

      const items = [];
      for (const article of articles) {
        const statusLink = article.querySelector('a[href*="/status/"]');
        const tweetUrl = statusLink ? statusLink.getAttribute('href') : '';
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const timeEl = article.querySelector('time');
        const userNameEl = article.querySelector('[data-testid="User-Name"]');

        let isPinned = false;
        let isRetweet = false;
        const socialContext = article.querySelector('[data-testid="socialContext"]');
        if (socialContext) {
          const scText = socialContext.innerText || '';
          if (scText.includes("Pinned") || scText.includes("置顶")) isPinned = true;
          if (scText.includes("reposted") || scText.includes("Retweeted") || scText.includes("转推")) isRetweet = true;
        } else {
          const topText = article.innerText.slice(0, 100);
          if (topText.includes("Pinned") || topText.includes("置顶")) isPinned = true;
          if (topText.includes("reposted") || topText.includes("Retweeted") || topText.includes("转推")) isRetweet = true;
        }

        let displayName = '';
        let userHandle = '';
        if (userNameEl) {
          const rawUserName = userNameEl.innerText || '';
          const lines = rawUserName.split(/\\r?\\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
          if (lines.length > 0) {
            displayName = lines[0].replace(/[\\r\\n]+/g, ' ').trim();
          }
          const foundHandle = lines.find(function(s) { return s.startsWith('@'); });
          if (foundHandle) {
            userHandle = foundHandle.replace(/[\\r\\n]+/g, '').trim();
          }
        }

        const text = textEl ? textEl.innerText.trim() : '(该推文为纯媒体/卡片内容，无文本)';
        const displayTime = timeEl ? timeEl.innerText.trim() : '';
        const datetime = timeEl ? (timeEl.getAttribute('datetime') || '') : '';

        // Quote detection
        let hasQuote = false;
        let quoteUrl = '';

        // 1. Nested article indicates a quote tweet card
        if (article.querySelector('article')) {
          hasQuote = true;
        }

        // 2. Element with data-href or role="link" pointing to another status
        const quoteCardEl = article.querySelector('[data-href*="/status/"]');
        if (quoteCardEl) {
          hasQuote = true;
          const dh = quoteCardEl.getAttribute('data-href') || '';
          if (dh) quoteUrl = dh.startsWith('http') ? dh : ('https://x.com' + dh);
        }

        // 3. Status links in href or data-href (with properly escaped template regex)
        const allStatusLinks = Array.from(article.querySelectorAll('a[href*="/status/"], [data-href*="/status/"]'));
        const mainStatusMatch = tweetUrl ? tweetUrl.match(/\\/status\\/(\\d+)/) : null;
        const mainStatusId = mainStatusMatch ? mainStatusMatch[1] : '';

        for (const link of allStatusLinks) {
          const href = link.getAttribute('data-href') || link.getAttribute('href') || '';
          const m = href.match(/\\/status\\/(\\d+)/);
          if (m && m[1] && m[1] !== mainStatusId) {
            hasQuote = true;
            if (!quoteUrl) {
              quoteUrl = href.startsWith('http') ? href : ('https://x.com' + href);
            }
            break;
          }
        }

        // 4. Other known quote card markers
        if (!hasQuote) {
          if (article.querySelector('[data-testid="quoteTweet"]') ||
              article.querySelector('[role="link"] [data-testid="User-Name"]') ||
              article.querySelectorAll('time').length > 1 ||
              article.querySelectorAll('[data-testid="tweetText"]').length > 1) {
            hasQuote = true;
          }
        }

        // Truncated detection on Twitter web
        let isTruncated = false;
        if (article.querySelector('[data-testid="tweet-text-show-more-link"]') ||
            (textEl && (textEl.innerText.includes('Show more') || textEl.innerText.includes('显示更多')))) {
          isTruncated = true;
        }

        items.push({
          url: tweetUrl ? ('https://x.com' + tweetUrl) : '',
          text: text,
          time: displayTime || datetime,
          datetime: datetime,
          displayName: displayName,
          userHandle: userHandle,
          isPinned: isPinned,
          isRetweet: isRetweet,
          hasQuote: hasQuote,
          quoteUrl: quoteUrl,
          isTruncated: isTruncated
        });
      }

      return { success: true, items: items, avatarUrl: avatarUrl };
    } catch (e) {
      return { error: e.message };
    }
  })()
  `;
}

async function fetchTwitterSlot(slotIndex, { isBackground = false } = {}, { slots, bgWebviewsContainer }) {
  const slot = slots[slotIndex];
  if (!slot || slot.isFetching) return;

  const rawHandle = slot.handleInput.value.trim();
  const handle = normalizeTwitterHandle(rawHandle);

  if (!handle) {
    if (!isBackground) {
      showSlotError(slot, '请输入 Twitter handle 或 Discord 频道链接');
      if (slot.authorHeader) slot.authorHeader.style.display = 'none';
      if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
      slot.handleInput.focus();
    }
    return;
  }

  saveHandles(slots);

  slot.isFetching = true;
  slot.btnFetch.disabled = true;
  slot.btnFetch.classList.add('fetching');
  slot.btnFetch.title = '正在抓取推文...';

  // Check if we already have existing tweets for this exact handle
  const hasExisting = (slot.monitoredHandle === handle && Array.isArray(slot.loadedTweets) && slot.loadedTweets.length > 0);
  const existingTweets = hasExisting ? slot.loadedTweets : [];
  const existingKeys = new Set(existingTweets.map(t => getTweetKey(t)));

  // In background mode with existing tweets, keep tweets visible and only spin the refresh icon
  if (!isBackground || !hasExisting) {
    showSlotLoading(slot, `正在后台抓取 @${handle}...`);
  }

  const targetUrl = `https://x.com/${handle}`;

  // Identify newest non-pinned tweet key as our timeline boundary (last element in ascending sort)
  const existingNonPinned = existingTweets.filter(t => !t.isPinned);
  const boundaryTweet = existingNonPinned.length > 0 ? existingNonPinned[existingNonPinned.length - 1] : null;
  const boundaryKey = boundaryTweet ? getTweetKey(boundaryTweet) : null;

  try {
    const bgWebview = getOrCreateSlotWebview(slotIndex, bgWebviewsContainer, slots);
    await waitForWebviewReady(bgWebview);
    await loadWebviewTarget(bgWebview, targetUrl);

    // Brief grace period for Twitter SPA hydration
    await sleep(400);

    const INITIAL_TARGET_COUNT = 5;
    const collectedNewTweets = [];
    const seenInThisRun = new Set();
    const maxAttempts = hasExisting ? 15 : 35;
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;
    let latestAvatarUrl = '';
    let reachedBoundary = false;

    while (attempts < maxAttempts) {
      attempts++;

      // Guard: do not execute script if webview is currently navigating
      if (typeof bgWebview.isLoading === 'function' && bgWebview.isLoading()) {
        await sleep(350);
        continue;
      }

      await sleep(randomBetween(450, 750));

      try {
        const extractionScript = buildExtractionScript(handle);
        const result = await bgWebview.executeJavaScript(extractionScript);

        if (result && result.error) {
          if (!isBackground || !hasExisting) {
            showSlotError(slot, result.error);
          } else {
            console.warn(`[Background Fetch] Error for @${handle}:`, result.error);
          }
          return;
        }

        if (result && result.avatarUrl) {
          const isHighRes = result.avatarUrl.includes('_400x400');
          if (!latestAvatarUrl || (isHighRes && !latestAvatarUrl.includes('_400x400'))) {
            latestAvatarUrl = result.avatarUrl;
            updateSlotAvatar(slot, latestAvatarUrl);
          }
        }

        if (result && result.success && Array.isArray(result.items)) {
          let foundNewOnThisScroll = 0;

          for (const item of result.items) {
            const key = getTweetKey(item);
            if (seenInThisRun.has(key)) continue;
            seenInThisRun.add(key);

            // Boundary detection: if this normal tweet was already fetched before
            if (hasExisting && !item.isPinned) {
              if (boundaryKey && key === boundaryKey) {
                reachedBoundary = true;
                break;
              }
              if (existingKeys.has(key)) {
                reachedBoundary = true;
                break;
              }
            }

            if (!existingKeys.has(key)) {
              item.isUnread = true;
              collectedNewTweets.push(item);
              foundNewOnThisScroll++;
            }
          }

          if (reachedBoundary) {
            break;
          }

          if (!hasExisting && collectedNewTweets.length >= INITIAL_TARGET_COUNT) {
            break;
          }

          if (foundNewOnThisScroll > 0) {
            consecutiveEmptyScrolls = 0;
            if (!isBackground || !hasExisting) {
              slot.loadingText.innerText = hasExisting
                ? `发现新推文 (${collectedNewTweets.length})...`
                : `已获取 (${collectedNewTweets.length}/${INITIAL_TARGET_COUNT})...`;
            }
          } else {
            consecutiveEmptyScrolls++;
          }

          const scrollDistance = randomBetween(650, 1050);
          await bgWebview.executeJavaScript(`window.scrollBy({ top: ${scrollDistance}, behavior: 'smooth' });`);
          await sleep(randomBetween(300, 600));

          if (consecutiveEmptyScrolls >= 5) {
            break;
          }
        }
      } catch (e) {
        // Ignore temporary navigation re-evaluation errors
      }
    }

    if (!latestAvatarUrl && handle) {
      latestAvatarUrl = `https://unavatar.io/x/${handle}`;
      updateSlotAvatar(slot, latestAvatarUrl);
    }

    slot.monitoredHandle = handle;
    slot.lastFetchedAt = Date.now();
    saveLastFetchTime(slot.lastFetchedAt);
    saveLastFetchTimeTwitter(slot.lastFetchedAt);
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);

    if (hasExisting) {
      if (collectedNewTweets.length === 0) {
        if (!isBackground) {
          showToast(`@${handle} 已是最新，暂无新推文`, 'info', 2000);
        }
        const sortedExisting = processAndSortTweets(existingTweets);
        renderSlotTweets(slot, sortedExisting, handle, latestAvatarUrl, slots);
      } else {
        showToast(`@${handle} 抓取到 ${collectedNewTweets.length} 条新推文`, 'success', 2500);
        const merged = [...collectedNewTweets, ...existingTweets];
        const sorted = processAndSortTweets(merged);
        const finalTweets = sorted.slice(-20);
        renderSlotTweets(slot, finalTweets, handle, latestAvatarUrl, slots);
      }
    } else {
      if (collectedNewTweets.length > 0) {
        const sorted = processAndSortTweets(collectedNewTweets);
        const finalTweets = sorted.slice(-20);
        renderSlotTweets(slot, finalTweets, handle, latestAvatarUrl, slots);
      } else {
        if (!isBackground || !hasExisting) {
          showSlotError(slot, '抓取超时：未检测到推文。请确认右上角已登录，或该用户近期是否发过推文。');
        }
      }
    }
  } catch (err) {
    if (!isBackground || !hasExisting) {
      showSlotError(slot, `发生异常: ${err.message}`);
    } else {
      console.warn(`[Background Fetch] Exception for @${handle}:`, err);
    }
  } finally {
    slot.isFetching = false;
    slot.btnFetch.disabled = false;
    slot.btnFetch.classList.remove('fetching');
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
}

/**
 * Entry point for every slot refresh: picks the backend that matches whatever
 * the card is pointed at.
 */
async function fetchSlot(slotIndex, options = {}, context) {
  const slot = context.slots[slotIndex];
  if (!slot) return;

  const raw = slot.handleInput ? slot.handleInput.value.trim() : '';
  if (detectSourceType(raw) === SOURCE_DISCORD) {
    return fetchDiscordSlot(slotIndex, options, context);
  }
  return fetchTwitterSlot(slotIndex, options, context);
}

let isTwitterBackgroundFetching = false;
let isDiscordBackgroundFetching = false;
let twitterFetchTimer = null;
let twitterFetchTimeout = null;
let discordFetchTimer = null;
let discordFetchTimeout = null;
let activeBackgroundFetchContext = null;

async function runTwitterBackgroundFetch({ slots, bgWebviewsContainer, getActiveSlotCount }) {
  if (isTwitterBackgroundFetching) return;
  isTwitterBackgroundFetching = true;

  try {
    const totalSlots = getActiveSlotCount ? getActiveSlotCount() : slots.length;
    for (let i = 0; i < totalSlots; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const raw = slot.handleInput ? slot.handleInput.value.trim() : '';
      if (raw && detectSourceType(raw) === SOURCE_TWITTER && !slot.isFetching) {
        await fetchTwitterSlot(i, { isBackground: true }, { slots, bgWebviewsContainer });
        // Polite pause between sequential card crawls to avoid rapid bursts
        await sleep(1500);
      }
    }
  } catch (err) {
    console.error('[Twitter Background Fetch] Error during sequential crawl:', err);
  } finally {
    isTwitterBackgroundFetching = false;
    saveLastFetchTimeTwitter(Date.now());
  }
}

async function runDiscordBackgroundFetch({ slots, bgWebviewsContainer, getActiveSlotCount }) {
  if (isDiscordBackgroundFetching) return;
  isDiscordBackgroundFetching = true;

  try {
    const totalSlots = getActiveSlotCount ? getActiveSlotCount() : slots.length;
    for (let i = 0; i < totalSlots; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const raw = slot.handleInput ? slot.handleInput.value.trim() : '';
      if (raw && detectSourceType(raw) === SOURCE_DISCORD && !slot.isFetching) {
        await fetchDiscordSlot(i, { isBackground: true }, { slots, bgWebviewsContainer });
        // Polite pause between sequential card crawls to avoid rapid bursts
        await sleep(1500);
      }
    }
  } catch (err) {
    console.error('[Discord Background Fetch] Error during sequential crawl:', err);
  } finally {
    isDiscordBackgroundFetching = false;
    saveLastFetchTimeDiscord(Date.now());
  }
}

async function runBackgroundFetch(context) {
  const ctx = context || activeBackgroundFetchContext;
  if (!ctx) return;
  await Promise.all([
    runTwitterBackgroundFetch(ctx),
    runDiscordBackgroundFetch(ctx)
  ]);
}

function clearPeriodicBackgroundFetch() {
  if (twitterFetchTimer) {
    clearInterval(twitterFetchTimer);
    twitterFetchTimer = null;
  }
  if (twitterFetchTimeout) {
    clearTimeout(twitterFetchTimeout);
    twitterFetchTimeout = null;
  }
  if (discordFetchTimer) {
    clearInterval(discordFetchTimer);
    discordFetchTimer = null;
  }
  if (discordFetchTimeout) {
    clearTimeout(discordFetchTimeout);
    discordFetchTimeout = null;
  }
}

function startPeriodicBackgroundFetch(context) {
  if (context) {
    activeBackgroundFetchContext = context;
  } else {
    context = activeBackgroundFetchContext;
  }
  if (!context) return;

  clearPeriodicBackgroundFetch();

  const now = Date.now();

  // 1. Twitter Periodic Background Fetch
  const twitterMinutes = getTwitterIntervalMinutes();
  if (twitterMinutes > 0) {
    const twitterIntervalMs = Math.round(twitterMinutes * 60 * 1000);
    const lastTwitterRaw = getLastFetchTimeTwitter();
    const lastTwitterTime = lastTwitterRaw ? parseInt(lastTwitterRaw, 10) : 0;
    const elapsedTwitter = lastTwitterTime > 0 ? (now - lastTwitterTime) : Infinity;

    // If fetch is due (elapsed >= interval, or never fetched), trigger in 5s;
    // otherwise wait for the remainder of the interval.
    let delayUntilTwitter = 5000;
    if (elapsedTwitter < twitterIntervalMs) {
      delayUntilTwitter = Math.max(twitterIntervalMs - elapsedTwitter, 5000);
    }

    twitterFetchTimeout = setTimeout(() => {
      runTwitterBackgroundFetch(context);
      twitterFetchTimer = setInterval(() => {
        runTwitterBackgroundFetch(context);
      }, twitterIntervalMs);
    }, delayUntilTwitter);
  }

  // 2. Discord Periodic Background Fetch
  const discordMinutes = getDiscordIntervalMinutes();
  if (discordMinutes > 0) {
    const discordIntervalMs = Math.round(discordMinutes * 60 * 1000);
    const lastDiscordRaw = getLastFetchTimeDiscord();
    const lastDiscordTime = lastDiscordRaw ? parseInt(lastDiscordRaw, 10) : 0;
    const elapsedDiscord = lastDiscordTime > 0 ? (now - lastDiscordTime) : Infinity;

    // If fetch is due (elapsed >= interval, or never fetched), trigger in 5s;
    // otherwise wait for the remainder of the interval.
    let delayUntilDiscord = 5000;
    if (elapsedDiscord < discordIntervalMs) {
      delayUntilDiscord = Math.max(discordIntervalMs - elapsedDiscord, 5000);
    }

    discordFetchTimeout = setTimeout(() => {
      runDiscordBackgroundFetch(context);
      discordFetchTimer = setInterval(() => {
        runDiscordBackgroundFetch(context);
      }, discordIntervalMs);
    }, delayUntilDiscord);
  }
}

module.exports = {
  buildExtractionScript,
  fetchSlot,
  fetchTwitterSlot,
  runBackgroundFetch,
  runTwitterBackgroundFetch,
  runDiscordBackgroundFetch,
  startPeriodicBackgroundFetch,
  clearPeriodicBackgroundFetch
};
