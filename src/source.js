/**
 * Source detection helpers.
 *
 * A slot is driven by whatever the user typed into its input box: either a bare
 * Twitter handle or a Discord channel URL. Detection lives in its own tiny,
 * dependency-free module so that the UI layer (slot.js), the dispatcher
 * (scraper.js) and the Discord scraper can all share it without forming a
 * require() cycle.
 */

const SOURCE_TWITTER = 'twitter';
const SOURCE_DISCORD = 'discord';

// https://discord.com/channels/<guildId|@me>/<channelId>[/<messageId>]
// Also accepts discordapp.com plus the ptb/canary subdomains.
const DISCORD_CHANNEL_RE =
  /^(?:https?:\/\/)?(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(@me|\d{5,})\/(\d{5,})(?:\/(\d{5,}))?\/?/i;

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

function detectSourceType(input) {
  return isDiscordInput(input) ? SOURCE_DISCORD : SOURCE_TWITTER;
}

function buildDiscordChannelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function buildDiscordMessageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Normalizes a raw slot input into a bare Twitter handle. */
function normalizeTwitterHandle(input) {
  return String(input || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^(https?:\/\/)?(www\.)?(twitter|x)\.com\//, '')
    .replace(/\/$/, '');
}

/**
 * Produces a stable, case-insensitive lookup key for any Twitter handle or
 * Discord channel URL so scraped data can be indexed per account/channel.
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
  const cleanHandle = normalizeTwitterHandle(raw).toLowerCase();
  if (!cleanHandle) return '';
  return `twitter:${cleanHandle}`;
}

module.exports = {
  SOURCE_TWITTER,
  SOURCE_DISCORD,
  parseDiscordChannelUrl,
  isDiscordInput,
  detectSourceType,
  buildDiscordChannelUrl,
  buildDiscordMessageUrl,
  normalizeTwitterHandle,
  getCanonicalTargetKey
};
