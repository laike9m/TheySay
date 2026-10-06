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
const STORAGE_DISCORD_SOUND_KEY = 'theysay_discord_sound_enabled';
const STORAGE_MUTED_SLOTS_KEY = 'theysay_slot_muted';
const STORAGE_TICKER_HIGHLIGHT_ENABLED_KEY = 'theysay_ticker_highlight_enabled';
const STORAGE_TICKER_FG_COLOR_KEY = 'theysay_ticker_fg_color';
const STORAGE_TICKER_BG_COLOR_KEY = 'theysay_ticker_bg_color';
const STORAGE_TICKER_REMOTE_CACHE_KEY = 'theysay_ticker_remote_cache';

const DEFAULT_TWITTER_INTERVAL_MINUTES = 10;
const DEFAULT_DISCORD_INTERVAL_MINUTES = 10;
const DEFAULT_SHOW_MEMBER_ONLY = true;
// The offscreen Discord client still plays Discord's own pings (DMs, @mentions,
// ...). Kept on by default to match Discord itself; users can mute it in Settings.
const DEFAULT_DISCORD_SOUND_ENABLED = true;
// Per-slot system notifications default to muted (true) so users only get OS
// notifications for channels they explicitly unmute.
const DEFAULT_SLOT_MUTED = true;
const DEFAULT_TICKER_HIGHLIGHT_ENABLED = true;
const DEFAULT_TICKER_FG_COLOR = '#fde047';
const DEFAULT_TICKER_BG_COLOR = '#422006';

const TICKER_COLOR_PRESETS = [
  { id: 'amber', name: '琥珀金', fg: '#fde047', bg: '#422006' },
  { id: 'highlighter', name: '荧光黄', fg: '#0f172a', bg: '#facc15' },
  { id: 'emerald', name: '看涨绿', fg: '#4ade80', bg: '#063925' },
  { id: 'cyberblue', name: '电光蓝', fg: '#38bdf8', bg: '#0c2d48' },
  { id: 'neonpurple', name: '霓虹紫', fg: '#c084fc', bg: '#2e1065' },
  { id: 'crimson', name: '朱砂红', fg: '#fda4af', bg: '#4c0519' }
];

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
  STORAGE_DISCORD_SOUND_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_TICKER_HIGHLIGHT_ENABLED_KEY,
  STORAGE_TICKER_FG_COLOR_KEY,
  STORAGE_TICKER_BG_COLOR_KEY,
  STORAGE_TICKER_REMOTE_CACHE_KEY,
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_SLOT_MUTED,
  DEFAULT_TICKER_HIGHLIGHT_ENABLED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  TICKER_COLOR_PRESETS,
  BACKGROUND_FETCH_INTERVAL_MS,
  DISCORD_PARTITION,
  DISCORD_WEBVIEW_ID,
  DISCORD_LOGIN_URL,
  MAX_DISCORD_MESSAGES
};
