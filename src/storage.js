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
  STORAGE_DISCORD_LOGIN_KEY,
  STORAGE_TWITTER_INTERVAL_KEY,
  STORAGE_DISCORD_INTERVAL_KEY,
  STORAGE_SHOW_MEMBER_ONLY_KEY,
  STORAGE_DISCORD_SOUND_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_TICKER_HIGHLIGHT_ENABLED_KEY,
  STORAGE_TICKER_FG_COLOR_KEY,
  STORAGE_TICKER_BG_COLOR_KEY,
  STORAGE_TICKER_REMOTE_CACHE_KEY,
  STORAGE_HEADER_BG_COLOR_KEY,
  STORAGE_LANGUAGE_KEY,
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_SLOT_MUTED,
  DEFAULT_TICKER_HIGHLIGHT_ENABLED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  DEFAULT_HEADER_BG_COLOR
} = require('./constants');
const { detectSourceType, getCanonicalTargetKey } = require('./source');
const { getTweetKey, getTweetTimestamp } = require('./tweet');
const { getCurrentLanguage, setActiveLanguageOverride } = require('./i18n');

const MAX_CACHE_TRACKED_KEYS = 500;

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
    if (Array.isArray(entry.tweets)) {
      entry.tweets.forEach(t => {
        if (!t) return;
        const k = getTweetKey(t);
        if (k) knownSet.add(k);
        if (!t.isUnread) {
          if (k) readSet.add(k);
          const ts = getTweetTimestamp(t);
          if (!t.isPinned && ts > maxReadTs) {
            maxReadTs = ts;
          }
        }
      });
    }
  };

  ingestEntry(prevEntry);
  ingestEntry(nextEntry);

  const mergedTweets = Array.isArray(nextEntry.tweets)
    ? nextEntry.tweets.map(t => {
        if (!t) return t;
        const k = getTweetKey(t);
        if (k && readSet.has(k) && t.isUnread) {
          return { ...t, isUnread: false };
        }
        return t;
      })
    : nextEntry.tweets;

  return {
    ...nextEntry,
    tweets: mergedTweets,
    readKeys: Array.from(readSet).slice(-MAX_CACHE_TRACKED_KEYS),
    knownKeys: Array.from(knownSet).slice(-MAX_CACHE_TRACKED_KEYS),
    maxReadTimestamp: maxReadTs
  };
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
    // If the user is mid-edit on a slot that already has loaded tweets for a monitored handle,
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
    if (!data || !Array.isArray(data.tweets) || data.tweets.length === 0) return;
    const rawTarget = handleOrUrl || data.handle || '';
    const key = getCanonicalTargetKey(rawTarget, data.source);
    if (!key) return;

    const targetCache = getTargetCache();
    const prev = targetCache[key] || null;
    const merged = mergeCacheEntryReadState(prev, {
      ...data,
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
    if (targetCache[key] && Array.isArray(targetCache[key].tweets) && targetCache[key].tweets.length > 0) {
      return targetCache[key];
    }

    // Fallback: scan slot cache in case an entry exists there that hasn't been indexed yet
    const slotCache = getSlotCache();
    for (const slotKey of Object.keys(slotCache)) {
      const entry = slotCache[slotKey];
      if (entry && Array.isArray(entry.tweets) && entry.tweets.length > 0) {
        const entryTargetKey = getCanonicalTargetKey(entry.handle, entry.source);
        if (entryTargetKey === key) {
          saveTargetCacheEntry(entry.handle, entry);
          return entry;
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
      if (cache[slotIndex] && Array.isArray(cache[slotIndex].tweets) && cache[slotIndex].tweets.length > 0) {
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
        if (entry && Array.isArray(entry.tweets) && entry.tweets.length > 0) {
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

function saveRawGridLayout(layoutData) {
  try {
    if (Array.isArray(layoutData)) {
      localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, JSON.stringify(layoutData));
    }
  } catch (e) {}
}

function saveGridLayout(grid) {
  if (!grid) return;
  try {
    const items = typeof grid.getGridItems === 'function' ? grid.getGridItems() : [];
    if (items.length > 0) {
      const layoutData = items.map(el => {
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
      localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, JSON.stringify(layoutData));
    } else {
      const layoutData = grid.save(false);
      localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, JSON.stringify(layoutData));
    }
  } catch (e) {}
}

function getStoredPreset() {
  return localStorage.getItem(STORAGE_PRESET_KEY) || '2x2';
}

function saveStoredPreset(preset) {
  localStorage.setItem(STORAGE_PRESET_KEY, preset);
}

function getStoredTheme() {
  return localStorage.getItem(STORAGE_THEME_KEY) || 'dark';
}

function saveStoredTheme(theme) {
  localStorage.setItem(STORAGE_THEME_KEY, theme);
}

function getLastFetchTime() {
  return localStorage.getItem(STORAGE_LAST_FETCH_KEY);
}

function saveLastFetchTime(timestamp) {
  localStorage.setItem(STORAGE_LAST_FETCH_KEY, String(timestamp));
}

function getLastFetchTimeTwitter() {
  try {
    return localStorage.getItem(STORAGE_LAST_FETCH_TWITTER_KEY) || localStorage.getItem(STORAGE_LAST_FETCH_KEY);
  } catch (e) {
    return null;
  }
}

function saveLastFetchTimeTwitter(timestamp) {
  try {
    localStorage.setItem(STORAGE_LAST_FETCH_TWITTER_KEY, String(timestamp));
    localStorage.setItem(STORAGE_LAST_FETCH_KEY, String(timestamp));
  } catch (e) {}
}

function getLastFetchTimeDiscord() {
  try {
    return localStorage.getItem(STORAGE_LAST_FETCH_DISCORD_KEY);
  } catch (e) {
    return null;
  }
}

function saveLastFetchTimeDiscord(timestamp) {
  try {
    localStorage.setItem(STORAGE_LAST_FETCH_DISCORD_KEY, String(timestamp));
  } catch (e) {}
}

function getTwitterIntervalMinutes() {
  try {
    const raw = localStorage.getItem(STORAGE_TWITTER_INTERVAL_KEY);
    if (raw !== null && raw !== '') {
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch (e) {}
  return DEFAULT_TWITTER_INTERVAL_MINUTES;
}

function saveTwitterIntervalMinutes(minutes) {
  try {
    localStorage.setItem(STORAGE_TWITTER_INTERVAL_KEY, String(minutes));
  } catch (e) {}
}

function getDiscordIntervalMinutes() {
  try {
    const raw = localStorage.getItem(STORAGE_DISCORD_INTERVAL_KEY);
    if (raw !== null && raw !== '') {
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch (e) {}
  return DEFAULT_DISCORD_INTERVAL_MINUTES;
}

function saveDiscordIntervalMinutes(minutes) {
  try {
    localStorage.setItem(STORAGE_DISCORD_INTERVAL_KEY, String(minutes));
  } catch (e) {}
}

// Discord stores its auth token in localStorage instead of cookies, so the main
// process cannot inspect the session the way it does for X. The flag below is
// maintained optimistically: the login window sets it, and any scrape that gets
// bounced to /login clears it again.
function getDiscordLoggedIn() {
  return localStorage.getItem(STORAGE_DISCORD_LOGIN_KEY) === '1';
}

function saveDiscordLoggedIn(loggedIn) {
  localStorage.setItem(STORAGE_DISCORD_LOGIN_KEY, loggedIn ? '1' : '0');
}

function getShowMemberOnlyTweets() {
  try {
    const raw = localStorage.getItem(STORAGE_SHOW_MEMBER_ONLY_KEY);
    if (raw !== null && raw !== '') {
      return raw === '1' || raw === 'true';
    }
  } catch (e) {}
  return DEFAULT_SHOW_MEMBER_ONLY;
}

function saveShowMemberOnlyTweets(show) {
  try {
    localStorage.setItem(STORAGE_SHOW_MEMBER_ONLY_KEY, show ? '1' : '0');
  } catch (e) {}
}

function getDiscordSoundEnabled() {
  try {
    const raw = localStorage.getItem(STORAGE_DISCORD_SOUND_KEY);
    if (raw !== null && raw !== '') {
      return raw === '1' || raw === 'true';
    }
  } catch (e) {}
  return DEFAULT_DISCORD_SOUND_ENABLED;
}

function saveDiscordSoundEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_DISCORD_SOUND_KEY, enabled ? '1' : '0');
  } catch (e) {}
}

function getTickerHighlightEnabled() {
  try {
    const raw = localStorage.getItem(STORAGE_TICKER_HIGHLIGHT_ENABLED_KEY);
    if (raw !== null && raw !== '') {
      return raw === '1' || raw === 'true';
    }
  } catch (e) {}
  return DEFAULT_TICKER_HIGHLIGHT_ENABLED;
}

function saveTickerHighlightEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_TICKER_HIGHLIGHT_ENABLED_KEY, enabled ? '1' : '0');
  } catch (e) {}
}

function getTickerFgColor() {
  try {
    const raw = localStorage.getItem(STORAGE_TICKER_FG_COLOR_KEY);
    if (raw && /^#[0-9A-Fa-f]{6}$/.test(raw.trim())) {
      return raw.trim().toLowerCase();
    }
  } catch (e) {}
  return DEFAULT_TICKER_FG_COLOR;
}

function saveTickerFgColor(color) {
  try {
    if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
      localStorage.setItem(STORAGE_TICKER_FG_COLOR_KEY, color.trim().toLowerCase());
    }
  } catch (e) {}
}

function getTickerBgColor() {
  try {
    const raw = localStorage.getItem(STORAGE_TICKER_BG_COLOR_KEY);
    if (raw && /^#[0-9A-Fa-f]{6}$/.test(raw.trim())) {
      return raw.trim().toLowerCase();
    }
  } catch (e) {}
  return DEFAULT_TICKER_BG_COLOR;
}

function saveTickerBgColor(color) {
  try {
    if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
      localStorage.setItem(STORAGE_TICKER_BG_COLOR_KEY, color.trim().toLowerCase());
    }
  } catch (e) {}
}

function getTickerRemoteCache() {
  try {
    const raw = localStorage.getItem(STORAGE_TICKER_REMOTE_CACHE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

function saveTickerRemoteCache(data) {
  try {
    localStorage.setItem(STORAGE_TICKER_REMOTE_CACHE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function getHeaderBgColor() {
  try {
    const raw = localStorage.getItem(STORAGE_HEADER_BG_COLOR_KEY);
    if (raw && /^#[0-9A-Fa-f]{6}$/.test(raw.trim())) {
      return raw.trim().toLowerCase();
    }
  } catch (e) {}
  return DEFAULT_HEADER_BG_COLOR;
}

function saveHeaderBgColor(color) {
  try {
    if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
      localStorage.setItem(STORAGE_HEADER_BG_COLOR_KEY, color.trim().toLowerCase());
    }
  } catch (e) {}
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
    showMemberOnlyTweets: settingsOverrides.showMemberOnlyTweets !== undefined
      ? settingsOverrides.showMemberOnlyTweets
      : getShowMemberOnlyTweets(),
    discordSoundEnabled: settingsOverrides.discordSoundEnabled !== undefined
      ? settingsOverrides.discordSoundEnabled
      : getDiscordSoundEnabled(),
    headerBgColor: settingsOverrides.headerBgColor !== undefined
      ? settingsOverrides.headerBgColor
      : getHeaderBgColor(),
    tickerHighlightEnabled: settingsOverrides.tickerHighlightEnabled !== undefined
      ? settingsOverrides.tickerHighlightEnabled
      : getTickerHighlightEnabled(),
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
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getDiscordLoggedIn,
  saveDiscordLoggedIn,
  getShowMemberOnlyTweets,
  saveShowMemberOnlyTweets,
  getDiscordSoundEnabled,
  saveDiscordSoundEnabled,
  getTickerHighlightEnabled,
  saveTickerHighlightEnabled,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor,
  getTickerRemoteCache,
  saveTickerRemoteCache,
  getHeaderBgColor,
  saveHeaderBgColor,
  getLanguage,
  saveLanguage,
  clearStoredLanguage,
  buildProfileData
};
