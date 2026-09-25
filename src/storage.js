const {
  DEFAULT_HANDLES,
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
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
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY
} = require('./constants');

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
  const current = slots.map(s => (s.handleInput ? s.handleInput.value.trim() : ''));
  localStorage.setItem(STORAGE_HANDLES_KEY, JSON.stringify(current));
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
      cache[slotIndex] = {
        ...data,
        lastFetchedAt: data.lastFetchedAt || (slots[slotIndex] && slots[slotIndex].lastFetchedAt) || null
      };
    } else {
      delete cache[slotIndex];
    }
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function saveAllSlotCache(cache) {
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

function saveGridLayout(grid) {
  if (!grid) return;
  try {
    const layoutData = grid.save(false);
    localStorage.setItem(STORAGE_GRID_LAYOUT_KEY, JSON.stringify(layoutData));
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

module.exports = {
  getSavedHandles,
  saveHandles,
  getSlotCache,
  saveSlotCache,
  saveAllSlotCache,
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
  saveShowMemberOnlyTweets
};
