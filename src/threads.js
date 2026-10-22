const { ipcRenderer } = require('electron');
const { randomBetween, sleep, showToast, isNetworkOnline, canReachHost } = require('./utils');
const {
  getPostKey,
  processAndSortPosts,
  ensureSlotReadTracking,
  recordSlotReadPosts,
  shouldMarkScrapedItemUnread,
  resetSlotReadTracking
} = require('./post');
const {
  saveHandles,
  saveLastFetchTime,
  saveLastFetchTimeThreads,
  saveThreadsLoggedIn
} = require('./storage');
const {
  getOrCreateThreadsSlotWebview,
  waitForWebviewReady,
  loadWebviewTarget,
  executeWebviewScript
} = require('./webview');
const {
  updateSlotAvatar,
  updateSlotFetchTimeUI,
  showSlotLoading,
  showSlotError,
  renderSlotPosts,
  persistSlot,
  archiveSlotScrapedData,
  restoreSlotFromTargetCache
} = require('./slot');
const {
  SOURCE_THREADS,
  normalizeThreadsHandle,
  buildThreadsProfileUrl,
  getCanonicalTargetKey
} = require('./source');
const { notifySlotNewMessages } = require('./notification');
const { t } = require('./i18n');

function buildThreadsExtractionScript(handle) {
  const cleanHandle = normalizeThreadsHandle(handle).toLowerCase();
  const errRateLimit = JSON.stringify(t('threads.rateLimit'));
  const errNotExist = JSON.stringify(t('threads.accountNotExist'));
  const errPrivate = JSON.stringify(t('threads.accountPrivate'));
  const errNotLoggedIn = JSON.stringify(t('threads.notLoggedIn'));
  const mediaOnlyFallback = JSON.stringify(t('scraper.mediaOnlyFallback'));

  return `
  (() => {
    try {
      const targetHandle = ${JSON.stringify(cleanHandle)};
      const bodyText = document.body ? document.body.innerText : '';

      if (
        bodyText.includes("Rate limit exceeded") ||
        bodyText.includes("Try Again Later") ||
        bodyText.includes("请稍后再试")
      ) {
        return { error: ${errRateLimit} };
      }

      if (
        bodyText.includes("Sorry, this page isn't available") ||
        bodyText.includes("Not all who wander are lost, but this page is") ||
        bodyText.includes("The link you followed may be broken") ||
        bodyText.includes("抱歉，此页面不可用") ||
        bodyText.includes("此页面不可用")
      ) {
        return { error: ${errNotExist} };
      }

      if (
        location.pathname.indexOf('/login') === 0 ||
        location.pathname.includes('/accounts/login')
      ) {
        return { error: ${errNotLoggedIn}, loginRedirect: true };
      }

      if (
        (bodyText.includes("This profile is private") || bodyText.includes("此个人主页为私密账号") || bodyText.includes("此账号为私密账号")) &&
        document.querySelectorAll('a[href*="/post/"]').length === 0
      ) {
        return { error: ${errPrivate} };
      }

      let allPressables = Array.from(document.querySelectorAll('[data-pressable-container="true"]'));
      let topContainers = allPressables.filter(el => !el.parentElement.closest('[data-pressable-container="true"]'));

      // Fallback if Threads changes data-pressable-container attribute
      if (topContainers.length === 0) {
        const postLinks = Array.from(document.querySelectorAll('a[href*="/post/"]')).filter(a => a.querySelector('time'));
        const derived = [];
        for (const a of postLinks) {
          let cur = a;
          for (let i = 0; i < 8; i++) {
            if (!cur.parentElement) break;
            const p = cur.parentElement;
            const pLinks = Array.from(p.querySelectorAll('a[href*="/post/"]')).filter(x => x.querySelector('time'));
            if (pLinks.length > 1) break;
            cur = p;
          }
          if (cur && !derived.includes(cur)) derived.push(cur);
        }
        topContainers = derived;
      }

      if (!topContainers || topContainers.length === 0) {
        return { pending: true };
      }

      // Extract profile displayName from og:title or document.title
      // Typical format: "Mark Zuckerberg (@zuck) • Threads, Say more" or "Mark Zuckerberg（@zuck）• Threads"
      let profileDisplayName = '';
      const ogTitleEl = document.querySelector('meta[property="og:title"]');
      const rawTitle = (ogTitleEl && ogTitleEl.getAttribute('content')) || document.title || '';
      const titleMatch = rawTitle.match(/^(.+?)\\s*[(（]@[A-Za-z0-9_.]+[)）]/);
      if (titleMatch && titleMatch[1]) {
        profileDisplayName = titleMatch[1].trim();
      }
      if (!profileDisplayName) {
        const h1 = document.querySelector('header h1, header h2, h1');
        if (h1 && h1.innerText) {
          const h1Text = h1.innerText.split(/[\\r\\n]+/)[0].trim();
          if (h1Text && h1Text.toLowerCase() !== targetHandle) {
            profileDisplayName = h1Text;
          }
        }
      }

      // Extract profile avatar URL
      let avatarUrl = '';
      const isValidAvatarSrc = (s) =>
        Boolean(s) &&
        !s.startsWith('data:') &&
        !s.endsWith('.svg') &&
        !s.includes('static.cdninstagram.com/rsrc.php');
      const isProfilePicBucket = (s) => /\\/t51\\.\\d+-19\\//.test(s) || s.includes('profile_pic');
      const isProfilePicAltText = (alt) =>
        alt.includes('profile picture') ||
        alt.includes('头像') ||
        alt.includes('大头贴照') ||
        alt.includes('大頭貼照') ||
        alt.includes('個人檔案相片') ||
        alt.includes('프로필 사진') ||
        alt.includes('プロフィール写真');

      const allImgs = Array.from(document.querySelectorAll('img'));
      // 1. Check profile header images outside the post feed first
      for (const img of allImgs) {
        const src = img.src || '';
        if (!isValidAvatarSrc(src)) continue;
        const inFeed = !!img.closest('[data-pressable-container="true"]');
        if (inFeed) continue;
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        if (isProfilePicAltText(alt) || isProfilePicBucket(src)) {
          avatarUrl = src;
          break;
        }
      }

      // 2. Fallback to feed post author avatar matching targetHandle
      if (!avatarUrl) {
        for (const img of allImgs) {
          const src = img.src || '';
          if (!isValidAvatarSrc(src)) continue;
          const alt = (img.getAttribute('alt') || '').toLowerCase();
          const matchesHandle = !targetHandle || alt.includes(targetHandle);
          if (isProfilePicAltText(alt) && matchesHandle) {
            avatarUrl = src;
            break;
          }
        }
      }

      // 3. Fallback to meta[property="og:image"] if it points to a real profile image
      if (!avatarUrl) {
        const ogImgEl = document.querySelector('meta[property="og:image"]');
        const ogImgUrl = ogImgEl ? (ogImgEl.getAttribute('content') || '').trim() : '';
        if (isValidAvatarSrc(ogImgUrl) && (ogImgUrl.includes('cdninstagram.com') || ogImgUrl.includes('fbcdn.net'))) {
          avatarUrl = ogImgUrl;
        }
      }

      const isActionCountText = (s) => /^\\d+(?:[.,]\\d+)?\\s*[KMB万亿]?$/i.test(s);

      const items = [];
      for (const container of topContainers) {
        const quoteContainer = container.querySelector('[data-pressable-container="true"]');
        const isOutsideQuote = (node) => !quoteContainer || !quoteContainer.contains(node);

        const timeLinks = Array.from(container.querySelectorAll('a[href*="/post/"]')).filter(
          a => isOutsideQuote(a) && a.querySelector('time')
        );
        const mainLink = timeLinks[0] || Array.from(container.querySelectorAll('a[href*="/post/"]')).find(isOutsideQuote);
        if (!mainLink) continue;

        const href = mainLink.getAttribute('href') || '';
        const postMatch = href.match(/\\/@?([^/]+)\\/post\\/([A-Za-z0-9_-]+)/);
        if (!postMatch) continue;

        const postAuthor = postMatch[1];
        const postCode = postMatch[2];
        const timeEl = mainLink.querySelector('time') || Array.from(container.querySelectorAll('time')).find(isOutsideQuote);
        const datetime = timeEl ? (timeEl.getAttribute('datetime') || '') : '';
        const displayTime = timeEl ? (timeEl.innerText || '').trim() : '';

        let isPinned = false;
        let isRetweet = false;
        if (targetHandle && postAuthor.toLowerCase() !== targetHandle) {
          isRetweet = true;
        }

        const topSlice = (container.innerText || '').slice(0, 140);
        if (/\\bPinned\\b|已置顶|置顶/i.test(topSlice)) {
          isPinned = true;
        }
        if (/\\bReposted\\b|已转发|转贴/i.test(topSlice)) {
          isRetweet = true;
        }

        // Extract post text from leaf span[dir="auto"] outside quoteContainer
        const textParts = [];
        const spans = Array.from(container.querySelectorAll('span[dir="auto"], div[dir="auto"]')).filter(isOutsideQuote);
        for (const s of spans) {
          if (s.querySelector('span[dir="auto"], div[dir="auto"]')) continue;
          if (s.querySelector('time') || s.closest('time')) continue;
          if (s.closest('[role="button"]')) continue;

          const linkEl = s.closest('a');
          if (linkEl) {
            const lHref = linkEl.getAttribute('href') || '';
            if (/^\\/@[^/]+\\/?$/.test(lHref) || lHref.includes('/post/')) continue;
          }

          const txt = (s.innerText || '').trim();
          if (!txt) continue;
          if (txt.toLowerCase() === postAuthor.toLowerCase() || txt.toLowerCase() === targetHandle) continue;
          if (/^(Pinned|已置顶|置顶|Reposted|.*\\s+reposted|.*\\s+已转发|Author|作者)$/i.test(txt)) {
            if (/Pinned|置顶/i.test(txt)) isPinned = true;
            if (/Reposted|已转发/i.test(txt)) isRetweet = true;
            continue;
          }
          if (isActionCountText(txt)) continue;
          if (textParts[textParts.length - 1] !== txt) {
            textParts.push(txt);
          }
        }

        // Extract post media images outside quoteContainer
        const images = [];
        const imgs = Array.from(container.querySelectorAll('img')).filter(isOutsideQuote);
        for (const img of imgs) {
          const src = img.src || '';
          const alt = (img.getAttribute('alt') || '').toLowerCase();
          if (!src || src.startsWith('data:') || src.endsWith('.svg')) continue;
          if (isProfilePicAltText(alt) || isProfilePicBucket(src)) {
            if (!avatarUrl && !isRetweet) {
              avatarUrl = src;
            }
            continue;
          }
          if (src.includes('s150x150') || src.includes('s100x100')) continue;
          const w = img.width || img.naturalWidth || 0;
          if (w > 0 && w <= 48) continue;
          if (!images.includes(src)) {
            images.push(src);
          }
        }

        const videos = Array.from(container.querySelectorAll('video')).filter(isOutsideQuote);
        for (const v of videos) {
          if (v.poster && !images.includes(v.poster)) {
            images.push(v.poster);
          }
        }

        // Extract quoted post if present
        let hasQuote = false;
        let quoteUrl = '';
        let quoteAuthor = '';
        let quoteText = '';

        if (quoteContainer) {
          hasQuote = true;
          const qLink = quoteContainer.querySelector('a[href*="/post/"]');
          if (qLink) {
            const qHref = qLink.getAttribute('href') || '';
            quoteUrl = qHref.startsWith('http') ? qHref : ('https://www.threads.com' + qHref);
            const qm = qHref.match(/\\/@?([^/]+)\\/post\\//);
            if (qm) quoteAuthor = '@' + qm[1];
          }
          const qParts = [];
          const qSpans = Array.from(quoteContainer.querySelectorAll('span[dir="auto"], div[dir="auto"]'));
          for (const qs of qSpans) {
            if (qs.querySelector('span[dir="auto"], div[dir="auto"]')) continue;
            if (qs.querySelector('time') || qs.closest('time')) continue;
            if (qs.closest('[role="button"]')) continue;
            const qLinkEl = qs.closest('a');
            if (qLinkEl) {
              const qlHref = qLinkEl.getAttribute('href') || '';
              if (/^\\/@[^/]+\\/?$/.test(qlHref)) {
                if (!quoteAuthor) quoteAuthor = '@' + qlHref.replace(/^\\/@?/, '').replace(/\\/$/, '');
                continue;
              }
            }
            const qt = (qs.innerText || '').trim();
            if (!qt || isActionCountText(qt)) continue;
            if (quoteAuthor && qt.toLowerCase() === quoteAuthor.replace(/^@/, '').toLowerCase()) continue;
            if (qParts[qParts.length - 1] !== qt) qParts.push(qt);
          }
          quoteText = qParts.join('\\n').trim();
        }

        let fullText = textParts.join('\\n').trim();
        if (!fullText && images.length === 0 && !hasQuote) {
          fullText = ${mediaOnlyFallback};
        }

        const isTruncated = fullText.includes('More') || fullText.endsWith('…') || fullText.endsWith('...');

        items.push({
          id: postCode,
          url: 'https://www.threads.com/@' + postAuthor + '/post/' + postCode,
          text: fullText,
          time: displayTime || datetime,
          datetime: datetime,
          displayName: (!isRetweet && profileDisplayName) ? profileDisplayName : postAuthor,
          userHandle: '@' + postAuthor,
          isPinned: isPinned,
          isRetweet: isRetweet,
          hasQuote: hasQuote,
          quoteUrl: quoteUrl,
          quoteAuthor: quoteAuthor,
          quoteText: quoteText,
          isTruncated: isTruncated,
          images: images,
          source: 'threads'
        });
      }

      return {
        success: true,
        items: items,
        avatarUrl: avatarUrl,
        displayName: profileDisplayName
      };
    } catch (e) {
      return { error: e.message };
    }
  })()
  `;
}

async function fetchThreadsSlot(
  slotIndex,
  { isBackground = false, prefetchedMeta = null } = {},
  { slots, bgWebviewsContainer }
) {
  const slot = slots[slotIndex];
  if (!slot || slot.isFetching) return { ok: false };

  const rawInput = slot.handleInput ? slot.handleInput.value.trim() : '';
  const handle = normalizeThreadsHandle(rawInput);

  if (!handle) {
    if (!isBackground) {
      showSlotError(slot, t('scraper.emptyInputError'));
      if (slot.authorHeader) slot.authorHeader.style.display = 'none';
      if (slot.inputWrapper) slot.inputWrapper.style.display = 'flex';
      if (slot.handleInput) slot.handleInput.focus();
    }
    return { ok: false };
  }

  saveHandles(slots);

  const prevKey = getCanonicalTargetKey(slot.monitoredHandle || '', slot.source);
  const currKey = getCanonicalTargetKey(rawInput, SOURCE_THREADS);
  if (prevKey !== currKey) {
    archiveSlotScrapedData(slot);
    const restored = restoreSlotFromTargetCache(slot, rawInput, slots);
    if (!restored) {
      resetSlotReadTracking(slot);
      slot.loadedPosts = [];
      slot.monitoredHandle = rawInput;
      slot.source = SOURCE_THREADS;
      updateSlotAvatar(slot, null);
    }
  } else if (!Array.isArray(slot.loadedPosts) || slot.loadedPosts.length === 0) {
    restoreSlotFromTargetCache(slot, rawInput, slots);
  }

  const hasExisting = (
    getCanonicalTargetKey(slot.monitoredHandle || '', slot.source) === currKey &&
    Array.isArray(slot.loadedPosts) &&
    slot.loadedPosts.length > 0
  );
  const existingPosts = hasExisting ? slot.loadedPosts : [];
  ensureSlotReadTracking(slot);
  if (hasExisting) {
    recordSlotReadPosts(slot, existingPosts);
  }
  const existingKeys = new Set([
    ...existingPosts.map(p => getPostKey(p)),
    ...(slot.knownKeys || []),
    ...(slot.readKeys || [])
  ]);

  if (!(await canReachHost('www.threads.com'))) {
    if (!isBackground) {
      if (!hasExisting) {
        showSlotError(slot, t('threads.offlineError'));
      }
      showToast(t('scraper.offlinePausedToast'), 'warning', 2500);
    }
    return { ok: false, offline: true };
  }

  slot.isFetching = true;
  if (slot.card) slot.card.classList.add('is-fetching');

  if (!hasExisting) {
    showSlotLoading(slot, t('threads.fetchingHandle', { handle }));
  }

  let latestAvatarUrl = (prefetchedMeta && prefetchedMeta.avatarUrl) ? prefetchedMeta.avatarUrl : '';
  let resolvedDisplayName = (prefetchedMeta && prefetchedMeta.displayName) ? prefetchedMeta.displayName : '';
  if (latestAvatarUrl) {
    updateSlotAvatar(slot, latestAvatarUrl);
  }

  // Kick off a fast background OG metadata probe if avatar/name wasn't pre-resolved
  const ogMetaPromise = (!latestAvatarUrl || !resolvedDisplayName)
    ? ipcRenderer.invoke('probe-handle-platforms', { handle, threadsOnly: true }).catch(() => null)
    : Promise.resolve(null);

  const targetUrl = buildThreadsProfileUrl(handle);

  const existingNonPinned = existingPosts.filter(p => !p.isPinned);
  const boundaryPost = existingNonPinned.length > 0 ? existingNonPinned[existingNonPinned.length - 1] : null;
  const boundaryKey = boundaryPost ? getPostKey(boundaryPost) : null;

  let slotOffline = false;
  try {
    const bgWebview = getOrCreateThreadsSlotWebview(slotIndex, bgWebviewsContainer, slots);
    await waitForWebviewReady(bgWebview);
    const loadRes = await loadWebviewTarget(bgWebview, targetUrl);
    if (loadRes && loadRes.offline) {
      slotOffline = true;
      if (!isBackground && !hasExisting) {
        showSlotError(slot, t('threads.offlineError'));
      }
      return { ok: false, offline: true };
    }

    await executeWebviewScript(
      bgWebview,
      "try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; window.scrollTo(0, 0); } catch (e) {}",
      3000
    );

    await sleep(550);

    const INITIAL_TARGET_COUNT = 5;
    const collectedNewPosts = [];
    const backfilledByKey = new Map();
    const seenInThisRun = new Set();
    const maxAttempts = hasExisting ? 12 : 25;
    let attempts = 0;
    let consecutiveEmptyScrolls = 0;
    let reachedBoundary = false;

    while (attempts < maxAttempts) {
      if (!isNetworkOnline()) {
        slotOffline = true;
        break;
      }
      attempts++;

      if (typeof bgWebview.isLoading === 'function' && bgWebview.isLoading()) {
        await sleep(350);
        continue;
      }

      await sleep(randomBetween(450, 750));

      try {
        const extractionScript = buildThreadsExtractionScript(handle);
        const result = await executeWebviewScript(bgWebview, extractionScript, 8000);

        if (!result) {
          consecutiveEmptyScrolls++;
          if (consecutiveEmptyScrolls >= 5) break;
          continue;
        }

        if (result && result.error) {
          if (result.loginRedirect) {
            saveThreadsLoggedIn(false);
          }
          if (!hasExisting) {
            showSlotError(slot, result.error);
          } else if (!isBackground) {
            showToast(`@${handle}: ${result.error}`, 'warning', 3000);
          } else {
            console.warn(`[Threads Background Fetch] Error for @${handle}:`, result.error);
          }
          return { ok: false };
        }

        if (result && result.displayName && !resolvedDisplayName) {
          resolvedDisplayName = result.displayName;
        }

        if (result && result.avatarUrl) {
          const isHighRes = result.avatarUrl.includes('s320x320') || result.avatarUrl.includes('s640x640');
          if (!latestAvatarUrl || (isHighRes && !latestAvatarUrl.includes('s320x320') && !latestAvatarUrl.includes('s640x640'))) {
            latestAvatarUrl = result.avatarUrl;
            updateSlotAvatar(slot, latestAvatarUrl);
          }
        }

        if (result && result.success && Array.isArray(result.items)) {
          let foundNewOnThisScroll = 0;

          for (const item of result.items) {
            item.source = SOURCE_THREADS;
            const key = getPostKey(item);
            if (!key) continue;

            if (existingKeys.has(key)) {
              backfilledByKey.set(key, item);
            }

            if (seenInThisRun.has(key)) continue;
            seenInThisRun.add(key);

            if (hasExisting && !item.isPinned && !item.isRetweet) {
              if ((boundaryKey && key === boundaryKey) || existingKeys.has(key)) {
                reachedBoundary = true;
                continue;
              }
            }

            if (!existingKeys.has(key)) {
              item.isUnread = hasExisting ? shouldMarkScrapedItemUnread(slot, item) : true;
              collectedNewPosts.push(item);
              foundNewOnThisScroll++;
            }
          }

          if (reachedBoundary) {
            break;
          }

          if (!hasExisting && collectedNewPosts.length >= INITIAL_TARGET_COUNT) {
            break;
          }

          if (foundNewOnThisScroll > 0) {
            consecutiveEmptyScrolls = 0;
            if (!hasExisting && slot.loadingText) {
              slot.loadingText.innerText = t('scraper.fetchedProgress', {
                count: collectedNewPosts.length,
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

    if (slotOffline && collectedNewPosts.length === 0) {
      if (!isBackground && !hasExisting) {
        showSlotError(slot, t('threads.offlineError'));
      }
      return { ok: false, offline: true };
    }

    // Verify slot wasn't switched to another target while scraping
    const currentSlotRaw = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
    if (currentSlotRaw && getCanonicalTargetKey(currentSlotRaw) !== currKey) {
      return { ok: false };
    }

    if (!latestAvatarUrl || !resolvedDisplayName) {
      const ogMeta = await ogMetaPromise;
      if (ogMeta && ogMeta.threads && ogMeta.threads.exists) {
        if (!latestAvatarUrl && ogMeta.threads.avatarUrl) {
          latestAvatarUrl = ogMeta.threads.avatarUrl;
        }
        if (!resolvedDisplayName && ogMeta.threads.displayName) {
          resolvedDisplayName = ogMeta.threads.displayName;
        }
      }
    }

    if (!latestAvatarUrl && slot.avatarImg && slot.avatarImg.src && !slot.avatarImg.src.includes('unavatar.io')) {
      latestAvatarUrl = slot.avatarImg.src;
    }
    if (latestAvatarUrl) {
      updateSlotAvatar(slot, latestAvatarUrl);
    }

    slot.monitoredHandle = rawInput;
    slot.source = SOURCE_THREADS;
    slot.lastFetchedAt = Date.now();
    saveLastFetchTime(slot.lastFetchedAt);
    saveLastFetchTimeThreads(slot.lastFetchedAt);
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);

    const liveExistingPosts = (
      hasExisting &&
      Array.isArray(slot.loadedPosts) &&
      slot.loadedPosts.length > 0
    )
      ? slot.loadedPosts
      : existingPosts;

    if (liveExistingPosts.length > 0) {
      liveExistingPosts.forEach(m => {
        const fresh = backfilledByKey.get(getPostKey(m));
        if (fresh) {
          if (Array.isArray(fresh.images) && fresh.images.length > 0 && (!Array.isArray(m.images) || m.images.length === 0)) {
            m.images = fresh.images;
          }
          if (fresh.quoteText && !m.quoteText) m.quoteText = fresh.quoteText;
          if (fresh.quoteAuthor && !m.quoteAuthor) m.quoteAuthor = fresh.quoteAuthor;
        }
      });
      recordSlotReadPosts(slot, liveExistingPosts);
    }

    const renderMeta = {
      source: SOURCE_THREADS,
      displayName: resolvedDisplayName || (slot.authorName ? slot.authorName.innerText : '') || handle,
      userHandle: `@${handle}`
    };

    if (hasExisting) {
      if (collectedNewPosts.length === 0) {
        if (!isBackground) {
          showToast(t('threads.upToDateToast', { handle }), 'info', 2000);
        }
        const sortedExisting = processAndSortPosts(liveExistingPosts);
        recordSlotReadPosts(slot, sortedExisting);
        renderSlotPosts(slot, sortedExisting, rawInput, latestAvatarUrl, slots, renderMeta);
      } else {
        collectedNewPosts.forEach(item => {
          if (!shouldMarkScrapedItemUnread(slot, item)) {
            item.isUnread = false;
          }
        });
        const unreadNewPosts = collectedNewPosts.filter(p => p.isUnread);
        const merged = [...liveExistingPosts, ...collectedNewPosts];
        const sorted = processAndSortPosts(merged);
        const finalPosts = sorted.slice(-Math.max(20, liveExistingPosts.length));
        recordSlotReadPosts(slot, finalPosts);
        renderSlotPosts(slot, finalPosts, rawInput, latestAvatarUrl, slots, renderMeta);
        if (unreadNewPosts.length > 0) {
          showToast(t('threads.newPostsToast', { handle, count: unreadNewPosts.length }), 'success', 2500);
          notifySlotNewMessages(slot, unreadNewPosts);
        } else if (!isBackground) {
          showToast(t('threads.upToDateToast', { handle }), 'info', 2000);
        }
      }
    } else {
      if (collectedNewPosts.length > 0) {
        const sorted = processAndSortPosts(collectedNewPosts);
        const finalPosts = sorted.slice(-20);
        recordSlotReadPosts(slot, finalPosts);
        renderSlotPosts(slot, finalPosts, rawInput, latestAvatarUrl, slots, renderMeta);
      } else {
        showSlotError(slot, t('threads.fetchTimeoutError'));
      }
    }
  } catch (err) {
    if (!hasExisting) {
      showSlotError(slot, t('scraper.exceptionError', { message: err.message }));
    } else if (!isBackground) {
      showToast(t('scraper.exceptionToast', { handle, message: err.message }), 'warning', 3000);
    } else {
      console.warn(`[Threads Background Fetch] Exception for @${handle}:`, err);
    }
  } finally {
    slot.isFetching = false;
    if (slot.card) slot.card.classList.remove('is-fetching');
    updateSlotFetchTimeUI(slot, slot.lastFetchedAt);
  }
  return { ok: !slotOffline, offline: slotOffline };
}

module.exports = {
  buildThreadsExtractionScript,
  fetchThreadsSlot
};
