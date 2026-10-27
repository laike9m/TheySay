/**
 * Source detection helpers.
 *
 * A slot is driven by whatever the user typed into its input box: a Twitter
 * handle/URL, a Threads profile URL/handle, or a Discord channel URL. Detection
 * lives in its own tiny, dependency-free module so that the UI layer (slot.js),
 * the dispatcher (scraper.js) and the platform scrapers can all share it
 * without forming a require() cycle.
 */

const SOURCE_TWITTER = 'twitter';
const SOURCE_DISCORD = 'discord';
const SOURCE_THREADS = 'threads';

// https://discord.com/channels/<guildId|@me>/<channelId>[/<messageId>]
// Also accepts discordapp.com plus the ptb/canary subdomains.
const DISCORD_CHANNEL_RE =
  /^(?:https?:\/\/)?(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(@me|\d{5,})\/(\d{5,})(?:\/(\d{5,}))?\/?/i;

// https://www.threads.com/@<handle>[/post/<code...>] or threads.net/@<handle>
const THREADS_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?threads\.(?:com|net)\/(@?[A-Za-z0-9_.]+)(?:\/(?:post\/([A-Za-z0-9_-]+))?.*)?$/i;

// Shorthand prefixes: threads:@handle, threads:handle, threads/@handle, or @handle@threads.net/.com
const THREADS_PREFIX_RE = /^(?:threads[:/]\s*@?([A-Za-z0-9_.]+)|@?([A-Za-z0-9_.]+)@threads\.(?:com|net))\/?$/i;

const THREADS_RESERVED_PATHS = new Set([
  'login',
  'logout',
  'settings',
  'search',
  'explore',
  'activity',
  'intent',
  't',
  'web',
  'about',
  'privacy',
  'terms'
]);

function parseDiscordChannelUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const m = raw.match(DISCORD_CHANNEL_RE);
  if (!m) return null;

  return {
    guildId: m[1],
    channelId: m[2],
    messageId: m[3] || ''
  };
}

function isDiscordInput(input) {
  return !!parseDiscordChannelUrl(input);
}

function parseThreadsInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const urlMatch = raw.match(THREADS_URL_RE);
  if (urlMatch) {
    const rawSegment = urlMatch[1] || '';
    const hasAt = rawSegment.startsWith('@');
    const cleanHandle = rawSegment.replace(/^@/, '').trim().toLowerCase();
    if (!cleanHandle) return null;
    if (!hasAt && THREADS_RESERVED_PATHS.has(cleanHandle)) {
      return null;
    }
    return {
      handle: cleanHandle,
      postCode: urlMatch[2] || ''
    };
  }

  const prefixMatch = raw.match(THREADS_PREFIX_RE);
  if (prefixMatch) {
    const cleanHandle = (prefixMatch[1] || prefixMatch[2] || '').trim().toLowerCase();
    if (!cleanHandle) return null;
    return {
      handle: cleanHandle,
      postCode: ''
    };
  }

  return null;
}

function isThreadsInput(input) {
  return !!parseThreadsInput(input);
}

function detectSourceType(input) {
  if (isDiscordInput(input)) return SOURCE_DISCORD;
  if (isThreadsInput(input)) return SOURCE_THREADS;
  return SOURCE_TWITTER;
}

function buildDiscordChannelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function buildDiscordMessageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function normalizeThreadsHandle(input) {
  const parsed = parseThreadsInput(input);
  if (parsed && parsed.handle) {
    return parsed.handle;
  }
  return String(input || '')
    .trim()
    .replace(/^threads[:/]\s*/i, '')
    .replace(/^(https?:\/\/)?(www\.)?threads\.(com|net)\//i, '')
    .replace(/@threads\.(com|net)$/i, '')
    .replace(/^@/, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
}

function buildThreadsProfileUrl(handleOrInput) {
  const cleanHandle = normalizeThreadsHandle(handleOrInput);
  return cleanHandle ? `https://www.threads.com/@${cleanHandle}` : 'https://www.threads.com';
}

function formatThreadsSlotInput(handleOrInput) {
  const cleanHandle = normalizeThreadsHandle(handleOrInput);
  return cleanHandle ? `threads.com/@${cleanHandle}` : '';
}

/** Normalizes a raw slot input into a bare Twitter handle. */
function normalizeTwitterHandle(input) {
  return String(input || '')
    .trim()
    .replace(/^(twitter|x):\s*@?/i, '')
    .replace(/^@/, '')
    .replace(/^(https?:\/\/)?(www\.)?(twitter|x)\.com\//, '')
    .replace(/\/$/, '');
}

/**
 * Returns true if the input is a bare handle (e.g. "mosseri" or "@mosseri")
 * without an explicit platform URL or prefix.
 */
function isAmbiguousBareHandle(input) {
  if (!input || typeof input !== 'string') return false;
  const raw = input.trim();
  if (!raw) return false;
  if (isDiscordInput(raw) || isThreadsInput(raw)) return false;
  if (/^(https?:\/\/)?(www\.)?(twitter|x)\.com\//i.test(raw)) return false;
  if (/^(twitter|x):\s*@?/i.test(raw)) return false;
  return /^@?[A-Za-z0-9_.]{1,30}$/.test(raw);
}

/**
 * Produces a stable, case-insensitive lookup key for any Twitter handle,
 * Threads account, or Discord channel URL so scraped data can be indexed per target.
 */
function getCanonicalTargetKey(input, sourceHint) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const source = sourceHint || detectSourceType(raw);
  if (source === SOURCE_DISCORD) {
    const parsed = parseDiscordChannelUrl(raw);
    if (parsed && parsed.guildId && parsed.channelId) {
      return `discord:${parsed.guildId}/${parsed.channelId}`;
    }
    return `discord:${raw.toLowerCase()}`;
  }
  if (source === SOURCE_THREADS) {
    const cleanThreads = normalizeThreadsHandle(raw).toLowerCase();
    if (!cleanThreads) return '';
    return `threads:${cleanThreads}`;
  }
  const cleanHandle = normalizeTwitterHandle(raw).toLowerCase();
  if (!cleanHandle) return '';
  return `twitter:${cleanHandle}`;
}

const { LRUCache } = require('lru-cache');
const PLATFORM_PROBE_TTL_MS = 60 * 1000;
const platformProbeCache = new LRUCache({ max: 200, ttl: PLATFORM_PROBE_TTL_MS });
const inflightPlatformProbes = new Map();

async function probeHandlePlatforms(handle, { threadsOnly = false, bypassCache = false } = {}) {
  const cleanHandle = String(handle || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^threads:\s*@?/i, '');
  if (!cleanHandle) {
    return { twitter: { exists: false }, threads: { exists: false } };
  }

  if (typeof window !== 'undefined' && typeof window.__THEYSAY_MOCK_PLATFORM_PROBE === 'function') {
    try {
      const mocked = await window.__THEYSAY_MOCK_PLATFORM_PROBE(cleanHandle, { threadsOnly });
      if (mocked && typeof mocked === 'object') return mocked;
    } catch (e) {}
  }

  const cacheKey = `${threadsOnly ? 'th' : 'all'}:${cleanHandle.toLowerCase()}`;
  if (!bypassCache) {
    const cached = platformProbeCache.get(cacheKey);
    if (cached) return cached;
  }

  if (inflightPlatformProbes.has(cacheKey)) {
    return inflightPlatformProbes.get(cacheKey);
  }

  const p = (async () => {
    try {
      const electron = require('electron');
      const ipcRenderer = electron && electron.ipcRenderer;
      if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
        return { twitter: { exists: false }, threads: { exists: false } };
      }
      const res = await ipcRenderer.invoke('probe-handle-platforms', {
        handle: cleanHandle,
        threadsOnly: Boolean(threadsOnly)
      });
      const normalized = {
        twitter: (res && res.twitter) || { exists: false },
        threads: (res && res.threads) || { exists: false }
      };
      platformProbeCache.set(cacheKey, normalized);
      return normalized;
    } catch (e) {
      return { twitter: { exists: false }, threads: { exists: false } };
    } finally {
      inflightPlatformProbes.delete(cacheKey);
    }
  })();

  inflightPlatformProbes.set(cacheKey, p);
  return p;
}

module.exports = {
  SOURCE_TWITTER,
  SOURCE_DISCORD,
  SOURCE_THREADS,
  parseDiscordChannelUrl,
  isDiscordInput,
  parseThreadsInput,
  isThreadsInput,
  isAmbiguousBareHandle,
  probeHandlePlatforms,
  detectSourceType,
  buildDiscordChannelUrl,
  buildDiscordMessageUrl,
  normalizeThreadsHandle,
  buildThreadsProfileUrl,
  formatThreadsSlotInput,
  normalizeTwitterHandle,
  getCanonicalTargetKey
};
