const {
  DEFAULT_HANDLES,
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_GRID_LAYOUT_KEY,
  STORAGE_THEME_KEY,
  STORAGE_LAST_FETCH_KEY
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
  saveLastFetchTime
};
