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
const STORAGE_LAST_FETCH_TWITTER_KEY = 'theysay_last_fetch_time_twitter';
const STORAGE_LAST_FETCH_DISCORD_KEY = 'theysay_last_fetch_time_discord';
const STORAGE_DISCORD_LOGIN_KEY = 'theysay_discord_logged_in';
const STORAGE_TWITTER_INTERVAL_KEY = 'theysay_twitter_interval_minutes';
const STORAGE_DISCORD_INTERVAL_KEY = 'theysay_discord_interval_minutes';
const STORAGE_SHOW_MEMBER_ONLY_KEY = 'theysay_show_member_only';

const DEFAULT_TWITTER_INTERVAL_MINUTES = 10;
const DEFAULT_DISCORD_INTERVAL_MINUTES = 10;
const DEFAULT_SHOW_MEMBER_ONLY = true;
const BACKGROUND_FETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (fallback)

// Discord runs in its own persistent session so that the X login stays untouched.
const DISCORD_PARTITION = 'persist:discord_session';
// A single shared Discord client is reused by every Discord slot: the web app is
// heavy (one gateway websocket per instance), and switching channels inside the
// already-running SPA is far cheaper than booting another copy of it.
const DISCORD_WEBVIEW_ID = 'discord-bg-webview';
const DISCORD_LOGIN_URL = 'https://discord.com/login';

// How many chat messages a Discord slot keeps. Chat channels are far chattier
// than a Twitter timeline, so this is deliberately larger than the tweet cap.
const MAX_DISCORD_MESSAGES = 40;

module.exports = {
  MAX_SLOTS,
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
  DEFAULT_SHOW_MEMBER_ONLY,
  BACKGROUND_FETCH_INTERVAL_MS,
  DISCORD_PARTITION,
  DISCORD_WEBVIEW_ID,
  DISCORD_LOGIN_URL,
  MAX_DISCORD_MESSAGES
};
