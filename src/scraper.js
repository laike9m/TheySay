const { BACKGROUND_FETCH_INTERVAL_MS } = require('./constants');
const { randomBetween, sleep, showToast, isNetworkOnline, canReachHost } = require('./utils');
const {
  getTweetKey,
  processAndSortTweets,
  ensureSlotReadTracking,
  recordSlotReadTweets,
  shouldMarkScrapedItemUnread,
  resetSlotReadTracking
} = require('./tweet');
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
const {
  getOrCreateSlotWebview,
  waitForWebviewReady,
  loadWebviewTarget,
  executeWebviewScript
} = require('./webview');
const {
  updateSlotAvatar,
  updateSlotFetchTimeUI,
  showSlotLoading,
  showSlotError,
  renderSlotTweets,
  persistSlot,
  archiveSlotScrapedData,
  restoreSlotFromTargetCache
} = require('./slot');
const { SOURCE_DISCORD, SOURCE_TWITTER, detectSourceType, normalizeTwitterHandle } = require('./source');
const { fetchDiscordSlot } = require('./discord');
const { notifySlotNewMessages } = require('./notification');
const { t } = require('./i18n');

function buildExtractionScript(handle) {
  const cleanHandle = String(handle || '').replace(/^@/, '').toLowerCase().trim();
  const errRateLimit = JSON.stringify(t('scraper.rateLimit'));
  const errCaptcha = JSON.stringify(t('scraper.captchaRequired'));
  const errNotExist = JSON.stringify(t('scraper.accountNotExist'));
  const errSuspended = JSON.stringify(t('scraper.accountSuspended'));
  const errProtected = JSON.stringify(t('scraper.accountProtected'));
  const errNotLoggedIn = JSON.stringify(t('scraper.notLoggedIn'));
  const mediaOnlyFallback = JSON.stringify(t('scraper.mediaOnlyFallback'));
  return `
  (() => {
    try {
      const targetHandle = ${JSON.stringify(cleanHandle)};
      const bodyText = document.body ? document.body.innerText : '';
      
      if (bodyText.includes("Rate limit exceeded") || bodyText.includes("超出频率限制")) {
        return { error: ${errRateLimit} };
      }
      if (document.querySelector('iframe[src*="arkose"]') || document.querySelector('iframe[src*="challenge"]') || bodyText.includes("Confirm you’re human") || bodyText.includes("请确认您是真人")) {
        return { error: ${errCaptcha} };
      }

      if (bodyText.includes("This account doesn’t exist") || bodyText.includes("此账号不存在")) {
        return { error: ${errNotExist} };
      }
      if (bodyText.includes("Account suspended") || bodyText.includes("账号已被冻结")) {
        return { error: ${errSuspended} };
      }
      if (bodyText.includes("These posts are protected") || bodyText.includes("这些帖子已受保护") || bodyText.includes("此账号已设置私密")) {
        return { error: ${errProtected} };
      }
      if (location.pathname.includes('/login') || location.pathname.includes('/i/flow/login')) {
        return { error: ${errNotLoggedIn} };
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
        const timeEl = article.querySelector('time');
        const userNameEl = article.querySelector('[data-testid="User-Name"]');
        const statusLink = (timeEl && timeEl.closest('a[href*="/status/"]')) ||
          (userNameEl && userNameEl.querySelector('a[href*="/status/"]')) ||
          article.querySelector('a[href*="/status/"]');
        const tweetUrl = statusLink ? statusLink.getAttribute('href') : '';
        let textEl = article.querySelector('[data-testid="tweetText"]');
        if (!textEl) {
          textEl = article.querySelector('[class*="whitespace-pre-wrap"]:not(a)');
        }

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
        if (!userHandle || !displayName) {
          const authorLinks = Array.from(article.querySelectorAll('a[href^="/"]'));
          for (const a of authorLinks) {
            const t = a.innerText.trim();
            if (t.startsWith('@') && !userHandle) {
              userHandle = t;
            } else if (t && !displayName && !a.href.includes('/status/') && !a.querySelector('img')) {
              displayName = t;
            }
          }
        }

        const text = textEl ? textEl.innerText.trim() : ${mediaOnlyFallback};
        const displayTime = timeEl ? timeEl.innerText.trim() : (statusLink ? statusLink.innerText.trim() : '');
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

        // Member-only / subscriber-only detection
        let isMemberOnly = false;
        const memberLink = article.querySelector('a[href*="/superfollows"], a[href*="/super_follows"], a[href*="/creator-subscriptions"], a[href*="/creator_subscriptions"]');
        if (memberLink && memberLink.closest('article') === article) {
          isMemberOnly = true;
        }

        if (!isMemberOnly) {
          const unlockEl = article.querySelector('[aria-label*="Subscribe to unlock" i], [aria-label*="Subscribe to view" i], [aria-label*="订阅以解锁" i], [aria-label*="订阅即可解锁" i], [aria-label*="订阅以查看" i], [data-testid="superFollowsBadge"]');
          if (unlockEl && unlockEl.closest('article') === article) {
            isMemberOnly = true;
          }
        }

        if (!isMemberOnly && socialContext) {
          const scText = (socialContext.innerText || '').toLowerCase();
          if (scText.includes('exclusive') || scText.includes('subscriber') || scText.includes('super follows') || scText.includes('独家') || scText.includes('会员专属') || scText.includes('订阅者专属')) {
            isMemberOnly = true;
          }
        }

        if (!isMemberOnly) {
          const artText = article.innerText || '';
          if (artText.includes('Subscribe to unlock') ||
              artText.includes('Subscribe to view') ||
              artText.includes('订阅以解锁') ||
              artText.includes('订阅即可解锁') ||
              artText.includes('订阅以查看') ||
              artText.includes('仅订阅者可见') ||
              artText.includes('仅会员可见')) {
            isMemberOnly = true;
          }
        }

        if (!isMemberOnly && tweetUrl && tweetUrl.includes('2103181567199687009')) {
          isMemberOnly = true;
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
          isTruncated: isTruncated,
          isMemberOnly: isMemberOnly
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
  if (!slot || slot.isFetching) return { ok: false };

  const rawHandle = slot.handleInput.value.trim();
  const handle = normalizeTwitterHandle(rawHandle);

  if (!handle) {
    if (!isBackground) {
      showSlotError(slot, t('scraper.emptyInputError'));
      if (slot.authorHeader) slot.authorHeader.style.display = 'none';
      if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
      slot.handleInput.focus();
    }
    return { ok: false };
  }

  saveHandles(slots);

  // If the slot was switched to a different handle, archive previous handle's tweets
  // and immediately restore any previously scraped tweets for the new handle.
  const prevMonitored = normalizeTwitterHandle(slot.monitoredHandle || '').toLowerCase();
  const isSameHandle = prevMonitored === handle.toLowerCase();
  if (!isSameHandle) {
    archiveSlotScrapedData(slot);
    const restored = restoreSlotFromTargetCache(slot, handle, slots);
    if (!restored) {
      resetSlotReadTracking(slot);
      slot.loadedTweets = [];
      slot.monitoredHandle = handle;
      updateSlotAvatar(slot, null);
    }
  } else if (!Array.isArray(slot.loadedTweets) || slot.loadedTweets.length === 0) {
    restoreSlotFromTargetCache(slot, handle, slots);
  }

  // Check if we already have existing tweets for this exact handle
  const hasExisting = (
    normalizeTwitterHandle(slot.monitoredHandle || '').toLowerCase() === handle.toLowerCase() &&
    Array.isArray(slot.loadedTweets) &&
    slot.loadedTweets.length > 0
  );
  const existingTweets = hasExisting ? slot.loadedTweets : [];
  ensureSlotReadTracking(slot);
  if (hasExisting) {
    recordSlotReadTweets(slot, existingTweets);
  }
  const existingKeys = new Set([
    ...existingTweets.map(t => getTweetKey(t)),
    ...(slot.knownKeys || []),
    ...(slot.readKeys || [])
  ]);

  // Skip fetching altogether when the network is disconnected
  if (!(await canReachHost('x.com'))) {
    if (!isBackground) {
      if (!hasExisting) {
        showSlotError(slot, t('scraper.offlineError'));
      }
      showToast(t('scraper.offlinePausedToast'), 'warning', 2500);
    }
    return { ok: false, offline: true };
  }

  slot.isFetching = true;
  if (slot.card) slot.card.classList.add('is-fetching');

  // Whenever existing tweets are present, keep them visible on screen while fetching
  if (!hasExisting) {
    showSlotLoading(slot, t('scraper.fetchingHandle', { handle }));
  }

  const targetUrl = `https://x.com/${handle}`;

  // Identify newest non-pinned tweet key as our timeline boundary (last element in ascending sort)
  const existingNonPinned = existingTweets.filter(t => !t.isPinned);
  const boundaryTweet = existingNonPinned.length > 0 ? existingNonPinned[existingNonPinned.length - 1] : null;
  const boundaryKey = boundaryTweet ? getTweetKey(boundaryTweet) : null;

  let slotOffline = false;
  try {
    const bgWebview = getOrCreateSlotWebview(slotIndex, bgWebviewsContainer, slots);
    await waitForWebviewReady(bgWebview);
    const loadRes = await loadWebviewTarget(bgWebview, targetUrl);
    if (loadRes && loadRes.offline) {
      slotOffline = true;
      if (!isBackground && !hasExisting) {
        showSlotError(slot, t('scraper.offlineError'));
      }
      return { ok: false, offline: true };
    }

    // Ensure the background webview starts at the very top of the profile timeline
    // so Chromium scroll restoration never hides new top tweets above the fold.
    await executeWebviewScript(
      bgWebview,
      "try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; window.scrollTo(0, 0); } catch (e) {}",
      3000
    );

    // Brief grace period for Twitter SPA hydration
    await sleep(450);

    const INITIAL_TARGET_COUNT = 5;
    const collectedNewTweets = [];
    const seenInThisRun = new Set();
    const maxAttempts = hasExisting ? 15 : 35;
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;
    let latestAvatarUrl = '';
    let reachedBoundary = false;

    while (attempts < maxAttempts) {
      if (!isNetworkOnline()) {
        slotOffline = true;
        break;
      }
      attempts++;

      // Guard: do not execute script if webview is currently navigating
      if (typeof bgWebview.isLoading === 'function' && bgWebview.isLoading()) {
        await sleep(350);
        continue;
      }

      await sleep(randomBetween(450, 750));

      try {
        const extractionScript = buildExtractionScript(handle);
        const result = await executeWebviewScript(bgWebview, extractionScript, 8000);

        if (!result) {
          consecutiveEmptyScrolls++;
          if (consecutiveEmptyScrolls >= 5) {
            break;
          }
          continue;
        }

        if (result && result.error) {
          if (!hasExisting) {
            showSlotError(slot, result.error);
          } else if (!isBackground) {
            showToast(`@${handle}: ${result.error}`, 'warning', 3000);
          } else {
            console.warn(`[Background Fetch] Error for @${handle}:`, result.error);
          }
          return { ok: false };
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
            if (!key || seenInThisRun.has(key)) continue;
            seenInThisRun.add(key);

            // Boundary detection: if this normal tweet was already fetched before
            if (hasExisting && !item.isPinned && !item.isRetweet) {
              if ((boundaryKey && key === boundaryKey) || existingKeys.has(key)) {
                reachedBoundary = true;
                continue;
              }
            }

            if (!existingKeys.has(key)) {
              item.isUnread = hasExisting ? shouldMarkScrapedItemUnread(slot, item) : true;
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
            if (!hasExisting) {
              slot.loadingText.innerText = t('scraper.fetchedProgress', {
                count: collectedNewTweets.length,
                target: INITIAL_TARGET_COUNT
              });
            }
          } else {
            consecutiveEmptyScrolls++;
          }

          const scrollDistance = randomBetween(650, 1050);
          await executeWebviewScript(
            bgWebview,
            `window.scrollBy({ top: ${scrollDistance}, behavior: 'smooth' });`,
            3000
          );
          await sleep(randomBetween(300, 600));

          if (consecutiveEmptyScrolls >= 5) {
            break;
          }
        }
      } catch (e) {
        // Ignore temporary navigation re-evaluation errors
      }
    }

    if (slotOffline && collectedNewTweets.length === 0) {
      if (!isBackground && !hasExisting) {
        showSlotError(slot, t('scraper.offlineError'));
      }
      return { ok: false, offline: true };
    }

    // Ensure slot wasn't switched to a different target while the scrape was in flight
    const currentSlotHandle = normalizeTwitterHandle(
      slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '')
    ).toLowerCase();
    if (currentSlotHandle && currentSlotHandle !== handle.toLowerCase()) {
      return { ok: false };
    }

    if (!latestAvatarUrl && handle) {
      latestAvatarUrl = (slot.avatarImg && slot.avatarImg.src) || `https://unavatar.io/x/${handle}`;
      updateSlotAvatar(slot, latestAvatarUrl);
    }

    slot.monitoredHandle = handle;
    slot.lastFetchedAt = Date.now();
    saveLastFetchTime(slot.lastFetchedAt);
    saveLastFetchTimeTwitter(slot.lastFetchedAt);
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);

    // Always read the live slot.loadedTweets right at merge time so any mark-as-read
    // action performed by the user while the scrape was running is preserved.
    const liveExistingTweets = (
      hasExisting &&
      Array.isArray(slot.loadedTweets) &&
      slot.loadedTweets.length > 0
    )
      ? slot.loadedTweets
      : existingTweets;
    if (liveExistingTweets.length > 0) {
      recordSlotReadTweets(slot, liveExistingTweets);
    }

    if (hasExisting) {
      if (collectedNewTweets.length === 0) {
        if (!isBackground) {
          showToast(t('scraper.upToDateToast', { handle }), 'info', 2000);
        }
        if (slot.tweetsList && slot.tweetsList.children.length > 0 && liveExistingTweets.length > 0) {
          persistSlot(slot, {
            handle,
            displayName: slot.authorName ? slot.authorName.innerText : '',
            userHandle: slot.authorHandle ? slot.authorHandle.innerText : '',
            tweets: liveExistingTweets,
            avatarUrl: latestAvatarUrl || (slot.avatarImg && slot.avatarImg.src) || ''
          }, slots);
        } else {
          const sortedExisting = processAndSortTweets(liveExistingTweets);
          recordSlotReadTweets(slot, sortedExisting);
          renderSlotTweets(slot, sortedExisting, handle, latestAvatarUrl, slots);
        }
      } else {
        collectedNewTweets.forEach(item => {
          if (!shouldMarkScrapedItemUnread(slot, item)) {
            item.isUnread = false;
          }
        });
        const unreadNewTweets = collectedNewTweets.filter(t => t.isUnread);
        const merged = [...liveExistingTweets, ...collectedNewTweets];
        const sorted = processAndSortTweets(merged);
        const finalTweets = sorted.slice(-Math.max(20, liveExistingTweets.length));
        recordSlotReadTweets(slot, finalTweets);
        renderSlotTweets(slot, finalTweets, handle, latestAvatarUrl, slots);
        if (unreadNewTweets.length > 0) {
          showToast(t('scraper.newTweetsToast', { handle, count: unreadNewTweets.length }), 'success', 2500);
          notifySlotNewMessages(slot, unreadNewTweets);
        } else if (!isBackground) {
          showToast(t('scraper.upToDateToast', { handle }), 'info', 2000);
        }
      }
    } else {
      if (collectedNewTweets.length > 0) {
        const sorted = processAndSortTweets(collectedNewTweets);
        const finalTweets = sorted.slice(-20);
        recordSlotReadTweets(slot, finalTweets);
        renderSlotTweets(slot, finalTweets, handle, latestAvatarUrl, slots);
      } else {
        showSlotError(slot, t('scraper.fetchTimeoutError'));
      }
    }
  } catch (err) {
    if (!hasExisting) {
      showSlotError(slot, t('scraper.exceptionError', { message: err.message }));
    } else if (!isBackground) {
      showToast(t('scraper.exceptionToast', { handle, message: err.message }), 'warning', 3000);
    } else {
      console.warn(`[Background Fetch] Exception for @${handle}:`, err);
    }
  } finally {
    slot.isFetching = false;
    if (slot.card) slot.card.classList.remove('is-fetching');
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
  return { ok: !slotOffline, offline: slotOffline };
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
  if (!(await canReachHost('x.com'))) return;
  isTwitterBackgroundFetching = true;

  let abortedOffline = false;
  try {
    const totalSlots = getActiveSlotCount ? getActiveSlotCount() : slots.length;
    for (let i = 0; i < totalSlots; i++) {
      if (!isNetworkOnline()) {
        abortedOffline = true;
        break;
      }
      const slot = slots[i];
      if (!slot) continue;
      const raw = slot.handleInput ? slot.handleInput.value.trim() : '';
      if (raw && detectSourceType(raw) === SOURCE_TWITTER && !slot.isFetching) {
        const res = await fetchTwitterSlot(i, { isBackground: true }, { slots, bgWebviewsContainer });
        if (res && res.offline) {
          abortedOffline = true;
          break;
        }
        // Polite pause between sequential card crawls to avoid rapid bursts
        await sleep(1500);
      }
    }
  } catch (err) {
    console.error('[Twitter Background Fetch] Error during sequential crawl:', err);
  } finally {
    isTwitterBackgroundFetching = false;
    if (!abortedOffline && isNetworkOnline()) {
      saveLastFetchTimeTwitter(Date.now());
    }
  }
}

async function runDiscordBackgroundFetch({ slots, bgWebviewsContainer, getActiveSlotCount }) {
  if (isDiscordBackgroundFetching) return;
  if (!(await canReachHost('discord.com'))) return;
  isDiscordBackgroundFetching = true;

  let abortedOffline = false;
  try {
    const totalSlots = getActiveSlotCount ? getActiveSlotCount() : slots.length;
    for (let i = 0; i < totalSlots; i++) {
      if (!isNetworkOnline()) {
        abortedOffline = true;
        break;
      }
      const slot = slots[i];
      if (!slot) continue;
      const raw = slot.handleInput ? slot.handleInput.value.trim() : '';
      if (raw && detectSourceType(raw) === SOURCE_DISCORD && !slot.isFetching) {
        const res = await fetchDiscordSlot(i, { isBackground: true }, { slots, bgWebviewsContainer });
        if (res && res.offline) {
          abortedOffline = true;
          break;
        }
        // Polite pause between sequential card crawls to avoid rapid bursts
        await sleep(1500);
      }
    }
  } catch (err) {
    console.error('[Discord Background Fetch] Error during sequential crawl:', err);
  } finally {
    isDiscordBackgroundFetching = false;
    if (!abortedOffline && isNetworkOnline()) {
      saveLastFetchTimeDiscord(Date.now());
    }
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
