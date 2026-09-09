const MAX_SLOTS = 16;

const DEFAULT_HANDLES = [
  'elonmusk', 'OpenAI', 'sama', 'karpathy',
  'ylecun', 'sama', 'sama', 'sama',
  'sama', 'sama', 'sama', 'sama',
  'sama', 'sama', 'sama', 'sama'
];

const STORAGE_HANDLES_KEY = 'theysay_slot_handles';
const STORAGE_CACHE_KEY = 'theysay_slot_cache';
const STORAGE_PRESET_KEY = 'theysay_grid_preset';
const STORAGE_GRID_LAYOUT_KEY = 'theysay_grid_layout';
const STORAGE_THEME_KEY = 'theysay_theme';
const STORAGE_LAST_FETCH_KEY = 'theysay_last_fetch_time';

const BACKGROUND_FETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

module.exports = {
  MAX_SLOTS,
  DEFAULT_HANDLES,
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_GRID_LAYOUT_KEY,
  STORAGE_THEME_KEY,
  STORAGE_LAST_FETCH_KEY,
  BACKGROUND_FETCH_INTERVAL_MS
};
