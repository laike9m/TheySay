const {
  MAX_SLOTS,
  DEFAULT_HANDLES,
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_TARGET_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_GRID_LAYOUT_KEY,
  STORAGE_THEME_KEY,
  STORAGE_LAST_FETCH_KEY,
  STORAGE_LAST_FETCH_TWITTER_KEY,
  STORAGE_LAST_FETCH_DISCORD_KEY,
  STORAGE_LAST_FETCH_THREADS_KEY,
  STORAGE_DISCORD_LOGIN_KEY,
  STORAGE_THREADS_LOGIN_KEY,
  STORAGE_TWITTER_EVER_LOGGED_IN_KEY,
  STORAGE_THREADS_EVER_LOGGED_IN_KEY,
  STORAGE_DISCORD_EVER_LOGGED_IN_KEY,
  STORAGE_TWITTER_LOGIN_EXPIRED_KEY,
  STORAGE_THREADS_LOGIN_EXPIRED_KEY,
  STORAGE_DISCORD_LOGIN_EXPIRED_KEY,
  STORAGE_TWITTER_INTERVAL_KEY,
  STORAGE_DISCORD_INTERVAL_KEY,
  STORAGE_THREADS_INTERVAL_KEY,
  STORAGE_SHOW_MEMBER_ONLY_KEY,
  STORAGE_DISCORD_SOUND_KEY,
  STORAGE_APP_BADGE_ENABLED_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_TICKER_FG_COLOR_KEY,
  STORAGE_TICKER_BG_COLOR_KEY,
  STORAGE_TICKER_REMOTE_CACHE_KEY,
  STORAGE_URL_TITLES_CACHE_KEY,
  STORAGE_HEADER_BG_COLOR_KEY,
  STORAGE_CHAT_BG_COLOR_KEY,
  STORAGE_BUBBLE_BG_COLOR_KEY,
  STORAGE_LANGUAGE_KEY,
  STORAGE_FILTER_KEYWORDS_KEY,
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_THREADS_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_APP_BADGE_ENABLED,
  DEFAULT_SLOT_MUTED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  DEFAULT_HEADER_BG_COLOR,
  DEFAULT_DARK_HEADER_BG_COLOR,
  DEFAULT_CHAT_BG_COLOR,
  DEFAULT_DARK_CHAT_BG_COLOR,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_DARK_BUBBLE_BG_COLOR,
  DEFAULT_FILTER_KEYWORDS
} = require('./constants');
const { detectSourceType, getCanonicalTargetKey } = require('./source');
const { getPostKey, getPostTimestamp, parseFilterKeywordsInput } = require('./post');
const { getCurrentLanguage, setActiveLanguageOverride } = require('./i18n');
const { colord } = require('colord');

const MAX_CACHE_TRACKED_KEYS = 500;

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writeStorage(key, val) {
  try {
    localStorage.setItem(key, String(val));
  } catch (_) {}
}

function createBoolStorage(key, defaultValue = false) {
  return [
    () => {
      const raw = readStorage(key);
      return raw !== null && raw !== '' ? (raw === '1' || raw === 'true') : defaultValue;
    },
    (val) => writeStorage(key, val ? '1' : '0')
  ];
}

function createIntervalStorage(key, defaultValue) {
  return [
    () => {
      const raw = readStorage(key);
      const val = raw !== null && raw !== '' ? parseFloat(raw) : NaN;
      return !isNaN(val) && val > 0 ? val : defaultValue;
    },
    (minutes) => writeStorage(key, minutes)
  ];
}

function createColorStorage(key, defaultValue) {
  return [
    () => {
      const raw = (readStorage(key) || '').trim();
      const parsed = raw ? colord(raw) : null;
      return parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw) ? parsed.toHex() : defaultValue;
    },
    (color) => {
      const raw = String(color || '').trim();
      const parsed = raw ? colord(raw) : null;
      if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
        writeStorage(key, parsed.toHex());
      }
    }
  ];
}

function getEntryPosts(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (Array.isArray(entry.posts)) return entry.posts;
  if (Array.isArray(entry.tweets)) return entry.tweets;
  return null;
}

function mergeCacheEntryReadState(prevEntry, nextEntry) {
  if (!nextEntry || typeof nextEntry !== 'object') return nextEntry;
  const readSet = new Set();
  const knownSet = new Set();
  let maxReadTs = 0;

  const ingestEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry.readKeys)) {
      entry.readKeys.forEach(k => { if (k) readSet.add(k); });
    }
    if (Array.isArray(entry.knownKeys)) {
      entry.knownKeys.forEach(k => { if (k) knownSet.add(k); });
    }
    if (typeof entry.maxReadTimestamp === 'number' && entry.maxReadTimestamp > maxReadTs) {
      maxReadTs = entry.maxReadTimestamp;
    }
    const entryPosts = getEntryPosts(entry);
    if (Array.isArray(entryPosts)) {
      entryPosts.forEach(p => {
        if (!p) return;
        const k = getPostKey(p);
        if (k) knownSet.add(k);
        if (!p.isUnread) {
          if (k) readSet.add(k);
          const ts = getPostTimestamp(p);
          if (!p.isPinned && ts > maxReadTs) {
            maxReadTs = ts;
          }
        }
      });
    }
  };

  ingestEntry(prevEntry);
  ingestEntry(nextEntry);

  const nextPosts = getEntryPosts(nextEntry);
  const mergedPosts = Array.isArray(nextPosts)
    ? nextPosts.map(p => {
        if (!p) return p;
        const k = getPostKey(p);
        if (k && readSet.has(k) && p.isUnread) {
          return { ...p, isUnread: false };
        }
        return p;
      })
    : nextPosts;

  const result = {
    ...nextEntry,
    posts: mergedPosts,
    readKeys: Array.from(readSet).slice(-MAX_CACHE_TRACKED_KEYS),
    knownKeys: Array.from(knownSet).slice(-MAX_CACHE_TRACKED_KEYS),
    maxReadTimestamp: maxReadTs
  };
  delete result.tweets;
  return result;
}

function getSavedHandles() {
  try {
    const raw = localStorage.getItem(STORAGE_HANDLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return DEFAULT_HANDLES;
}

function saveHandles(slots) {
  if (!Array.isArray(slots)) return;
  const current = slots.map(s => {
    if (!s) return '';
    // If the user is mid-edit on a slot that already has loaded posts for a monitored handle,
    // prefer the committed handle Input or monitoredHandle appropriately.
    return s.handleInput ? s.handleInput.value.trim() : (s.monitoredHandle || '');
  });
  localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(current));
}

function saveHandlesArray(handlesArray) {
  if (!Array.isArray(handlesArray)) return;
  try {
    const normalized = Array.from({ length: MAX_SLOTS }, (_, i) =>
      typeof handlesArray[i] === 'string' ? handlesArray[i].trim() : ''
    );
    localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(normalized));
  } catch (e) {}
}

function getMutedSlots() {
  try {
    const raw = localStorage.getItem(STORAGE_MUTED_SLOTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return Array.from({ length: MAX_SLOTS }, (_, i) =>
          typeof parsed[i] === 'boolean' ? parsed[i] : DEFAULT_SLOT_MUTED
        );
      }
    }
  } catch (e) {}
  return Array(MAX_SLOTS).fill(DEFAULT_SLOT_MUTED);
}

function saveMutedSlots(slots) {
  if (!Array.isArray(slots)) return;
  try {
    const current = slots.map(s => (s && typeof s.isMuted === 'boolean' ? s.isMuted : DEFAULT_SLOT_MUTED));
    localStorage.setItem(STORAGE_MUTED_SLOTS_KEY, JSON.stringify(current));
  } catch (e) {}
}

function saveMutedSlotsArray(mutedArray) {
  if (!Array.isArray(mutedArray)) return;
  try {
    const normalized = Array.from({ length: MAX_SLOTS }, (_, i) =>
      typeof mutedArray[i] === 'boolean' ? mutedArray[i] : DEFAULT_SLOT_MUTED
    );
    localStorage.setItem(STORAGE_MUTED_SLOTS_KEY, JSON.stringify(normalized));
  } catch (e) {}
}

function getTargetCache() {
  try {
    const raw = localStorage.getItem(STORAGE_TARGET_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveTargetCache(targetCache) {
  try {
    if (targetCache && typeof targetCache === 'object') {
      localStorage.setItem(STORAGE_TARGET_CACHE_KEY, JSON.stringify(targetCache));
    }
  } catch (e) {}
}

function saveTargetCacheEntry(handleOrUrl, data) {
  try {
    const posts = getEntryPosts(data);
    if (!data || !Array.isArray(posts) || posts.length === 0) return;
    const rawTarget = handleOrUrl || data.handle || '';
    const key = getCanonicalTargetKey(rawTarget, data.source);
    if (!key) return;

    const targetCache = getTargetCache();
    const prev = targetCache[key] || null;
    const merged = mergeCacheEntryReadState(prev, {
      ...data,
      posts,
      handle: data.handle || rawTarget,
      lastFetchedAt: data.lastFetchedAt || (prev && prev.lastFetchedAt) || Date.now()
    });
    targetCache[key] = merged;
    saveTargetCache(targetCache);
  } catch (e) {}
}

function getTargetCacheEntry(handleOrUrl, sourceHint) {
  try {
    const key = getCanonicalTargetKey(handleOrUrl, sourceHint);
    if (!key) return null;

    const targetCache = getTargetCache();
    const cachedPosts = getEntryPosts(targetCache[key]);
    if (targetCache[key] && Array.isArray(cachedPosts) && cachedPosts.length > 0) {
      return { ...targetCache[key], posts: cachedPosts };
    }

    // Fallback: scan slot cache in case an entry exists there that hasn't been indexed yet
    const slotCache = getSlotCache();
    for (const slotKey of Object.keys(slotCache)) {
      const entry = slotCache[slotKey];
      const entryPosts = getEntryPosts(entry);
      if (entry && Array.isArray(entryPosts) && entryPosts.length > 0) {
        const entryTargetKey = getCanonicalTargetKey(entry.handle, entry.source);
        if (entryTargetKey === key) {
          const normalized = { ...entry, posts: entryPosts };
          saveTargetCacheEntry(entry.handle, normalized);
          return normalized;
        }
      }
    }
  } catch (e) {}
  return null;
}

function getSlotCache() {
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveSlotCache(slotIndex, data, slots = []) {
  try {
    const cache = getSlotCache();
    if (data) {
      const slotObj = slots[slotIndex];
      const prevSlotEntry = cache[slotIndex] || null;
      const sameTargetPrev =
        prevSlotEntry &&
        getCanonicalTargetKey(prevSlotEntry.handle, prevSlotEntry.source) ===
          getCanonicalTargetKey(data.handle, data.source)
          ? prevSlotEntry
          : null;
      const entry = mergeCacheEntryReadState(sameTargetPrev, {
        ...data,
        isMuted: typeof data.isMuted === 'boolean'
          ? data.isMuted
          : (slotObj && typeof slotObj.isMuted === 'boolean' ? slotObj.isMuted : DEFAULT_SLOT_MUTED),
        lastFetchedAt: data.lastFetchedAt || (slotObj && slotObj.lastFetchedAt) || null
      });
      cache[slotIndex] = entry;
      // Archive into per-target cache so switching handles never loses scraped data
      saveTargetCacheEntry(entry.handle, entry);
    } else {
      // Preserve existing scraped data in per-target cache before removing slot binding
      const prevPosts = getEntryPosts(cache[slotIndex]);
      if (cache[slotIndex] && Array.isArray(prevPosts) && prevPosts.length > 0) {
        saveTargetCacheEntry(cache[slotIndex].handle, cache[slotIndex]);
      }
      delete cache[slotIndex];
    }
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function saveAllSlotCache(cache) {
  try {
    if (cache && typeof cache === 'object') {
      const existingSlotCache = getSlotCache();
      const targetCache = getTargetCache();
      let updatedTarget = false;
      for (const slotKey of Object.keys(cache)) {
        const entry = cache[slotKey];
        const entryPosts = getEntryPosts(entry);
        if (entry && Array.isArray(entryPosts) && entryPosts.length > 0) {
          const prevSlot = existingSlotCache[slotKey];
          const key = getCanonicalTargetKey(entry.handle, entry.source);
          const prevTarget = key ? targetCache[key] : null;
          const merged = mergeCacheEntryReadState(prevTarget || prevSlot, entry);
          cache[slotKey] = merged;
          if (key) {
            targetCache[key] = { ...merged };
            updatedTarget = true;
          }
        }
      }
      if (updatedTarget) {
        saveTargetCache(targetCache);
      }
    }
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function getSavedGridLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_GRID_LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return null;
}

function requestStorageFlush() {
  try {
    const { ipcRenderer } = require('electron');
    if (ipcRenderer && typeof ipcRenderer.send === 'function') {
      ipcRenderer.send('flush-storage-data');
    }
  } catch (_) {}
}

function saveRawGridLayout(layoutData) {
  try {
    if (Array.isArray(layoutData)) {
      const nextRaw = JSON.stringify(layoutData);
      const prevRaw = localStorage.getItem(STORAGE_GRID_LAYOUT_KEY);
      localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, nextRaw);
      if (prevRaw !== nextRaw) {
        requestStorageFlush();
      }
    }
  } catch (e) {}
}

function saveGridLayout(grid) {
  if (!grid) return;
  try {
    const items = typeof grid.getGridItems === 'function' ? grid.getGridItems() : [];
    let layoutData;
    if (items.length > 0) {
      layoutData = items.map(el => {
        const node = el.gridstackNode || {};
        const slotIndex = parseInt(el.getAttribute('data-slot-index'), 10);
        return {
          id: el.getAttribute('gs-id') || (Number.isFinite(slotIndex) ? `slot-${slotIndex}` : undefined),
          slotIndex: Number.isFinite(slotIndex) ? slotIndex : undefined,
          x: typeof node.x === 'number' ? node.x : 0,
          y: typeof node.y === 'number' ? node.y : 0,
          w: typeof node.w === 'number' ? node.w : 1,
          h: typeof node.h === 'number' ? node.h : 1
        };
      });
    } else {
      layoutData = grid.save(false);
    }
    const nextRaw = JSON.stringify(layoutData);
    const prevRaw = localStorage.getItem(STORAGE_GRID_LAYOUT_KEY);
    localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, nextRaw);
    if (prevRaw !== nextRaw) {
      requestStorageFlush();
    }
  } catch (e) {}
}

const getStoredPreset = () => readStorage(STORAGE_PRESET_KEY) || '2x2';
const saveStoredPreset = (preset) => writeStorage(STORAGE_PRESET_KEY, preset);

const getStoredTheme = () => readStorage(STORAGE_THEME_KEY) || 'dark';
const saveStoredTheme = (theme) => writeStorage(STORAGE_THEME_KEY, theme);

const getLastFetchTime = () => readStorage(STORAGE_LAST_FETCH_KEY);
const saveLastFetchTime = (timestamp) => writeStorage(STORAGE_LAST_FETCH_KEY, timestamp);

const getLastFetchTimeTwitter = () => readStorage(STORAGE_LAST_FETCH_TWITTER_KEY) || readStorage(STORAGE_LAST_FETCH_KEY);
const saveLastFetchTimeTwitter = (timestamp) => {
  writeStorage(STORAGE_LAST_FETCH_TWITTER_KEY, timestamp);
  writeStorage(STORAGE_LAST_FETCH_KEY, timestamp);
};

const getLastFetchTimeDiscord = () => readStorage(STORAGE_LAST_FETCH_DISCORD_KEY);
const saveLastFetchTimeDiscord = (timestamp) => writeStorage(STORAGE_LAST_FETCH_DISCORD_KEY, timestamp);

const getLastFetchTimeThreads = () => readStorage(STORAGE_LAST_FETCH_THREADS_KEY);
const saveLastFetchTimeThreads = (timestamp) => writeStorage(STORAGE_LAST_FETCH_THREADS_KEY, timestamp);

const [getTwitterIntervalMinutes, saveTwitterIntervalMinutes] = createIntervalStorage(
  STORAGE_TWITTER_INTERVAL_KEY,
  DEFAULT_TWITTER_INTERVAL_MINUTES
);
const [getDiscordIntervalMinutes, saveDiscordIntervalMinutes] = createIntervalStorage(
  STORAGE_DISCORD_INTERVAL_KEY,
  DEFAULT_DISCORD_INTERVAL_MINUTES
);
const [getThreadsIntervalMinutes, saveThreadsIntervalMinutes] = createIntervalStorage(
  STORAGE_THREADS_INTERVAL_KEY,
  DEFAULT_THREADS_INTERVAL_MINUTES
);

const [getTwitterEverLoggedIn, saveTwitterEverLoggedIn] = createBoolStorage(STORAGE_TWITTER_EVER_LOGGED_IN_KEY, false);
const [getThreadsEverLoggedIn, saveThreadsEverLoggedIn] = createBoolStorage(STORAGE_THREADS_EVER_LOGGED_IN_KEY, false);
const [getDiscordEverLoggedIn, saveDiscordEverLoggedIn] = createBoolStorage(STORAGE_DISCORD_EVER_LOGGED_IN_KEY, false);

const [getTwitterLoginExpired, saveTwitterLoginExpired] = createBoolStorage(STORAGE_TWITTER_LOGIN_EXPIRED_KEY, false);
const [getThreadsLoginExpired, saveThreadsLoginExpired] = createBoolStorage(STORAGE_THREADS_LOGIN_EXPIRED_KEY, false);
const [getDiscordLoginExpired, saveDiscordLoginExpired] = createBoolStorage(STORAGE_DISCORD_LOGIN_EXPIRED_KEY, false);

const getDiscordLoggedIn = () => readStorage(STORAGE_DISCORD_LOGIN_KEY) === '1';
const hasDiscordLoginStateBeenSet = () => readStorage(STORAGE_DISCORD_LOGIN_KEY) !== null;
function saveDiscordLoggedIn(loggedIn) {
  writeStorage(STORAGE_DISCORD_LOGIN_KEY, loggedIn ? '1' : '0');
  if (loggedIn) {
    saveDiscordEverLoggedIn(true);
    saveDiscordLoginExpired(false);
  }
}

const getThreadsLoggedIn = () => readStorage(STORAGE_THREADS_LOGIN_KEY) === '1';
const hasThreadsLoginStateBeenSet = () => readStorage(STORAGE_THREADS_LOGIN_KEY) !== null;
function saveThreadsLoggedIn(loggedIn) {
  writeStorage(STORAGE_THREADS_LOGIN_KEY, loggedIn ? '1' : '0');
  if (loggedIn) {
    saveThreadsEverLoggedIn(true);
    saveThreadsLoginExpired(false);
  }
}

function getPlatformEverLoggedIn(platform) {
  if (platform === 'discord') return getDiscordEverLoggedIn();
  if (platform === 'threads') return getThreadsEverLoggedIn();
  if (platform === 'twitter') return getTwitterEverLoggedIn();
  return false;
}

function savePlatformEverLoggedIn(platform, val) {
  if (platform === 'discord') saveDiscordEverLoggedIn(val);
  else if (platform === 'threads') saveThreadsEverLoggedIn(val);
  else if (platform === 'twitter') saveTwitterEverLoggedIn(val);
}

function getPlatformLoginExpired(platform) {
  if (platform === 'discord') return getDiscordLoginExpired();
  if (platform === 'threads') return getThreadsLoginExpired();
  if (platform === 'twitter') return getTwitterLoginExpired();
  return false;
}

function savePlatformLoginExpired(platform, val) {
  if (platform === 'discord') saveDiscordLoginExpired(val);
  else if (platform === 'threads') saveThreadsLoginExpired(val);
  else if (platform === 'twitter') saveTwitterLoginExpired(val);
}

const [getShowMemberOnlyPosts, saveShowMemberOnlyPosts] = createBoolStorage(
  STORAGE_SHOW_MEMBER_ONLY_KEY,
  DEFAULT_SHOW_MEMBER_ONLY
);
const [getDiscordSoundEnabled, saveDiscordSoundEnabled] = createBoolStorage(
  STORAGE_DISCORD_SOUND_KEY,
  DEFAULT_DISCORD_SOUND_ENABLED
);
const [getAppBadgeEnabled, saveAppBadgeEnabled] = createBoolStorage(
  STORAGE_APP_BADGE_ENABLED_KEY,
  DEFAULT_APP_BADGE_ENABLED
);

const [getTickerFgColor, saveTickerFgColor] = createColorStorage(
  STORAGE_TICKER_FG_COLOR_KEY,
  DEFAULT_TICKER_FG_COLOR
);
const [getTickerBgColor, saveTickerBgColor] = createColorStorage(
  STORAGE_TICKER_BG_COLOR_KEY,
  DEFAULT_TICKER_BG_COLOR
);
function getHeaderBgColor() {
  const raw = (readStorage(STORAGE_HEADER_BG_COLOR_KEY) || '').trim();
  const parsed = raw ? colord(raw) : null;
  if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
    return parsed.toHex();
  }
  return getStoredTheme() === 'light' ? DEFAULT_HEADER_BG_COLOR : DEFAULT_DARK_HEADER_BG_COLOR;
}

function saveHeaderBgColor(color) {
  const raw = String(color || '').trim();
  const parsed = raw ? colord(raw) : null;
  if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
    writeStorage(STORAGE_HEADER_BG_COLOR_KEY, parsed.toHex());
  }
}

function getChatBgColor() {
  const raw = (readStorage(STORAGE_CHAT_BG_COLOR_KEY) || '').trim();
  const parsed = raw ? colord(raw) : null;
  if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
    return parsed.toHex();
  }
  return getStoredTheme() === 'light' ? DEFAULT_CHAT_BG_COLOR : DEFAULT_DARK_CHAT_BG_COLOR;
}

function saveChatBgColor(color) {
  const raw = String(color || '').trim();
  const parsed = raw ? colord(raw) : null;
  if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
    writeStorage(STORAGE_CHAT_BG_COLOR_KEY, parsed.toHex());
  }
}

function getBubbleBgColor() {
  const raw = (readStorage(STORAGE_BUBBLE_BG_COLOR_KEY) || '').trim();
  const parsed = raw ? colord(raw) : null;
  if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
    return parsed.toHex();
  }
  return getStoredTheme() === 'light' ? DEFAULT_BUBBLE_BG_COLOR : DEFAULT_DARK_BUBBLE_BG_COLOR;
}

function saveBubbleBgColor(color) {
  const raw = String(color || '').trim();
  const parsed = raw ? colord(raw) : null;
  if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
    writeStorage(STORAGE_BUBBLE_BG_COLOR_KEY, parsed.toHex());
  }
}

function getTickerRemoteCache() {
  try {
    const raw = readStorage(STORAGE_TICKER_REMOTE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveTickerRemoteCache(data) {
  try {
    writeStorage(STORAGE_TICKER_REMOTE_CACHE_KEY, JSON.stringify(data));
  } catch (_) {}
}

function getUrlTitlesCache() {
  try {
    const raw = readStorage(STORAGE_URL_TITLES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveUrlTitlesCache(cacheObj) {
  if (cacheObj && typeof cacheObj === 'object') {
    writeStorage(STORAGE_URL_TITLES_CACHE_KEY, JSON.stringify(cacheObj));
  }
}

function getLanguage() {
  return getCurrentLanguage();
}

function saveLanguage(lang) {
  try {
    if (lang === 'en' || lang === 'zh') {
      localStorage.setItem(STORAGE_LANGUAGE_KEY, lang);
      if (typeof process !== 'undefined' && process && process.env) {
        process.env.THEYSAY_SAVED_LANGUAGE = lang;
      }
      setActiveLanguageOverride(lang);
      try {
        const { ipcRenderer } = require('electron');
        if (ipcRenderer) {
          ipcRenderer.send('set-language', { lang, persist: true });
        }
      } catch (_) {}
    }
  } catch (e) {}
}

function clearStoredLanguage() {
  try {
    localStorage.removeItem(STORAGE_LANGUAGE_KEY);
    if (typeof process !== 'undefined' && process && process.env) {
      delete process.env.THEYSAY_SAVED_LANGUAGE;
    }
    setActiveLanguageOverride(null);
    try {
      const { ipcRenderer } = require('electron');
      if (ipcRenderer) {
        ipcRenderer.send('set-language', { lang: null, persist: true });
      }
    } catch (_) {}
  } catch (e) {}
}

function getFilterKeywords() {
  try {
    const raw = localStorage.getItem(STORAGE_FILTER_KEYWORDS_KEY);
    if (raw !== null && raw !== '') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parseFilterKeywordsInput(parsed);
        }
      } catch (_) {
        return parseFilterKeywordsInput(raw);
      }
    }
  } catch (e) {}
  return [...DEFAULT_FILTER_KEYWORDS];
}

function saveFilterKeywords(keywords) {
  try {
    const normalized = parseFilterKeywordsInput(keywords);
    localStorage.setItem(STORAGE_FILTER_KEYWORDS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (e) {
    return [];
  }
}

function buildProfileData({ slots = [], grid = null, settingsOverrides = {} } = {}) {
  if (grid) {
    saveGridLayout(grid);
  }

  const savedHandles = getSavedHandles();
  const savedMuted = getMutedSlots();
  const slotCache = getSlotCache();
  const gridLayout = getSavedGridLayout() || [];

  const layoutBySlot = {};
  gridLayout.forEach((item, idx) => {
    const sIdx = typeof item.slotIndex === 'number'
      ? item.slotIndex
      : (typeof item.id === 'string' && item.id.startsWith('slot-')
          ? parseInt(item.id.replace('slot-', ''), 10)
          : idx);
    if (Number.isFinite(sIdx)) {
      layoutBySlot[sIdx] = {
        x: typeof item.x === 'number' ? item.x : 0,
        y: typeof item.y === 'number' ? item.y : 0,
        w: typeof item.w === 'number' ? item.w : 1,
        h: typeof item.h === 'number' ? item.h : 1
      };
    }
  });

  const handles = [];
  const mutedSlots = [];
  const slotsData = [];
  const following = [];

  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = slots[i];
    const cached = slotCache[i] || {};
    const handle = slot
      ? ((slot.handleInput && slot.handleInput.value.trim()) || slot.monitoredHandle || '')
      : (savedHandles[i] || '');
    const isMuted = slot && typeof slot.isMuted === 'boolean'
      ? slot.isMuted
      : (typeof savedMuted[i] === 'boolean' ? savedMuted[i] : DEFAULT_SLOT_MUTED);
    const targetCached = handle ? (getTargetCacheEntry(handle) || cached) : cached;

    const source = handle ? detectSourceType(handle) : (slot && slot.source) || targetCached.source || 'twitter';
    const displayName = (slot && slot.authorName && slot.authorName.innerText.trim()) || targetCached.displayName || '';
    const userHandle = (slot && slot.authorHandle && slot.authorHandle.innerText.trim()) || targetCached.userHandle || '';
    const sourceTitle = (slot && slot.sourceTitle) || targetCached.sourceTitle || '';
    const sourceSubtitle = (slot && slot.sourceSubtitle) || targetCached.sourceSubtitle || '';
    const avatarUrl = (slot && slot.avatarImg && slot.avatarImg.src) || targetCached.avatarUrl || '';

    handles.push(handle);
    mutedSlots.push(isMuted);

    const slotEntry = {
      index: i,
      handle,
      source,
      isMuted,
      displayName,
      userHandle,
      sourceTitle,
      sourceSubtitle,
      avatarUrl,
      grid: layoutBySlot[i] || null
    };
    slotsData.push(slotEntry);

    if (handle) {
      following.push({
        slotIndex: i,
        handle,
        source,
        displayName,
        userHandle,
        sourceTitle,
        sourceSubtitle,
        isMuted,
        avatarUrl
      });
    }
  }

  const settings = {
    language: settingsOverrides.language !== undefined ? settingsOverrides.language : getLanguage(),
    theme: settingsOverrides.theme !== undefined ? settingsOverrides.theme : getStoredTheme(),
    gridPreset: settingsOverrides.gridPreset !== undefined ? settingsOverrides.gridPreset : getStoredPreset(),
    gridLayout,
    twitterIntervalMinutes: settingsOverrides.twitterIntervalMinutes !== undefined
      ? settingsOverrides.twitterIntervalMinutes
      : getTwitterIntervalMinutes(),
    discordIntervalMinutes: settingsOverrides.discordIntervalMinutes !== undefined
      ? settingsOverrides.discordIntervalMinutes
      : getDiscordIntervalMinutes(),
    threadsIntervalMinutes: settingsOverrides.threadsIntervalMinutes !== undefined
      ? settingsOverrides.threadsIntervalMinutes
      : getThreadsIntervalMinutes(),
    showMemberOnlyPosts: settingsOverrides.showMemberOnlyPosts !== undefined
      ? settingsOverrides.showMemberOnlyPosts
      : getShowMemberOnlyPosts(),
    filterKeywords: settingsOverrides.filterKeywords !== undefined
      ? parseFilterKeywordsInput(settingsOverrides.filterKeywords)
      : getFilterKeywords(),
    discordSoundEnabled: settingsOverrides.discordSoundEnabled !== undefined
      ? settingsOverrides.discordSoundEnabled
      : getDiscordSoundEnabled(),
    appBadgeEnabled: settingsOverrides.appBadgeEnabled !== undefined
      ? settingsOverrides.appBadgeEnabled
      : getAppBadgeEnabled(),
    headerBgColor: settingsOverrides.headerBgColor !== undefined
      ? settingsOverrides.headerBgColor
      : getHeaderBgColor(),
    chatBgColor: settingsOverrides.chatBgColor !== undefined
      ? settingsOverrides.chatBgColor
      : getChatBgColor(),
    bubbleBgColor: settingsOverrides.bubbleBgColor !== undefined
      ? settingsOverrides.bubbleBgColor
      : getBubbleBgColor(),
    tickerFgColor: settingsOverrides.tickerFgColor !== undefined
      ? settingsOverrides.tickerFgColor
      : getTickerFgColor(),
    tickerBgColor: settingsOverrides.tickerBgColor !== undefined
      ? settingsOverrides.tickerBgColor
      : getTickerBgColor(),
    mutedSlots
  };

  return {
    app: 'TheySay',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    following,
    handles,
    slots: slotsData
  };
}

module.exports = {
  getSavedHandles,
  saveHandles,
  saveHandlesArray,
  getMutedSlots,
  saveMutedSlots,
  saveMutedSlotsArray,
  getTargetCache,
  saveTargetCache,
  saveTargetCacheEntry,
  getTargetCacheEntry,
  mergeCacheEntryReadState,
  getSlotCache,
  saveSlotCache,
  saveAllSlotCache,
  getSavedGridLayout,
  saveRawGridLayout,
  saveGridLayout,
  getStoredPreset,
  saveStoredPreset,
  getStoredTheme,
  saveStoredTheme,
  getLastFetchTime,
  saveLastFetchTime,
  getLastFetchTimeTwitter,
  saveLastFetchTimeTwitter,
  getLastFetchTimeDiscord,
  saveLastFetchTimeDiscord,
  getLastFetchTimeThreads,
  saveLastFetchTimeThreads,
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getThreadsIntervalMinutes,
  saveThreadsIntervalMinutes,
  getDiscordLoggedIn,
  hasDiscordLoginStateBeenSet,
  saveDiscordLoggedIn,
  getThreadsLoggedIn,
  hasThreadsLoginStateBeenSet,
  saveThreadsLoggedIn,
  getTwitterEverLoggedIn,
  saveTwitterEverLoggedIn,
  getThreadsEverLoggedIn,
  saveThreadsEverLoggedIn,
  getDiscordEverLoggedIn,
  saveDiscordEverLoggedIn,
  getTwitterLoginExpired,
  saveTwitterLoginExpired,
  getThreadsLoginExpired,
  saveThreadsLoginExpired,
  getDiscordLoginExpired,
  saveDiscordLoginExpired,
  getPlatformEverLoggedIn,
  savePlatformEverLoggedIn,
  getPlatformLoginExpired,
  savePlatformLoginExpired,
  getShowMemberOnlyPosts,
  saveShowMemberOnlyPosts,
  getFilterKeywords,
  saveFilterKeywords,
  getDiscordSoundEnabled,
  saveDiscordSoundEnabled,
  getAppBadgeEnabled,
  saveAppBadgeEnabled,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor,
  getTickerRemoteCache,
  saveTickerRemoteCache,
  getUrlTitlesCache,
  saveUrlTitlesCache,
  getHeaderBgColor,
  saveHeaderBgColor,
  getChatBgColor,
  saveChatBgColor,
  getBubbleBgColor,
  saveBubbleBgColor,
  getLanguage,
  saveLanguage,
  clearStoredLanguage,
  buildProfileData
};

