function getTweetId(tweet) {
  if (!tweet) return '';
  if (tweet.id) return String(tweet.id);
  if (tweet.url) {
    const m = String(tweet.url).match(/\/status\/(\d+)/);
    if (m) return m[1];
    const tm = String(tweet.url).match(/\/post\/([A-Za-z0-9_-]+)/);
    if (tm) return tm[1];
  }
  return '';
}

// Snowflake epochs: Twitter counts from 2010-11-04, Discord from 2015-01-01.
const TWITTER_EPOCH = 1288834974657n;
const DISCORD_EPOCH = 1420070400000n;

function getTweetTimestamp(tweet) {
  if (typeof tweet.timestamp === 'number' && tweet.timestamp > 0) {
    return tweet.timestamp;
  }
  if (tweet.datetime) {
    const parsed = Date.parse(tweet.datetime);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const id = getTweetId(tweet);
  if (id && /^\d+$/.test(id)) {
    try {
      const epoch = tweet.source === 'discord' ? DISCORD_EPOCH : TWITTER_EPOCH;
      return Number((BigInt(id) >> 22n) + epoch);
    } catch (e) {}
  }
  return 0;
}

function getTweetKey(tweet) {
  if (!tweet) return '';
  const prefix = tweet.source === 'discord'
    ? 'discord_'
    : (tweet.source === 'threads' ? 'threads_' : '');
  const id = getTweetId(tweet);
  if (id) return `${prefix}id_${id}`;
  if (tweet.url) return `${prefix}url_${tweet.url}`;
  return `${prefix}txt_${(tweet.text || '').slice(0, 40)}_${tweet.datetime || tweet.time || ''}`;
}

function processAndSortTweets(tweets) {
  if (!Array.isArray(tweets) || tweets.length === 0) return [];

  // 1. Ensure id, timestamp, and isMemberOnly are calculated
  const normalized = tweets.map(t => ({
    ...t,
    id: getTweetId(t),
    timestamp: getTweetTimestamp(t),
    isMemberOnly: isMemberOnlyTweet(t)
  }));

  // 2. Deduplicate by unique key (preserving isUnread: false and backfilled fields)
  const uniqueMap = new Map();
  for (const t of normalized) {
    const key = getTweetKey(t);
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, t);
    } else {
      const prev = uniqueMap.get(key);
      if (prev.isUnread === false || t.isUnread === false) {
        prev.isUnread = false;
      }
      if (!prev.avatarUrl && t.avatarUrl) prev.avatarUrl = t.avatarUrl;
      if (t.hasQuote && !prev.hasQuote) prev.hasQuote = true;
      if (t.quoteUrl && !prev.quoteUrl) prev.quoteUrl = t.quoteUrl;
      if (t.quoteAuthor && !prev.quoteAuthor) prev.quoteAuthor = t.quoteAuthor;
      if (t.quoteText && !prev.quoteText) prev.quoteText = t.quoteText;
      if (Array.isArray(t.images) && t.images.length > 0 && (!Array.isArray(prev.images) || prev.images.length === 0)) {
        prev.images = t.images;
      }
      if (Array.isArray(t.attachments) && t.attachments.length > 0 && (!Array.isArray(prev.attachments) || prev.attachments.length === 0)) {
        prev.attachments = t.attachments;
      }
    }
  }
  const uniqueTweets = Array.from(uniqueMap.values());

  // 3. Separate non-pinned and pinned tweets
  const nonPinned = uniqueTweets.filter(t => !t.isPinned);
  const pinned = uniqueTweets.filter(t => t.isPinned);

  // 4. "如果置顶的帖子比最老的帖子还老，那就不显示它"
  let validPinned = [];
  if (nonPinned.length > 0) {
    let oldestNonPinnedTime = Infinity;
    for (const t of nonPinned) {
      if (t.timestamp > 0 && t.timestamp < oldestNonPinnedTime) {
        oldestNonPinnedTime = t.timestamp;
      }
    }

    validPinned = pinned.filter(p => {
      // If pinned post is older than the oldest non-pinned post, drop it!
      if (oldestNonPinnedTime !== Infinity && p.timestamp > 0) {
        return p.timestamp >= oldestNonPinnedTime;
      }
      return true;
    });
  } else {
    validPinned = pinned;
  }

  // 5. "从上到下是从旧到新（升序排序，最新推文在最下面）"
  const combined = [...validPinned, ...nonPinned];
  combined.sort((a, b) => {
    const timeA = a.timestamp || 0;
    const timeB = b.timestamp || 0;
    if (timeA !== timeB) {
      return timeA - timeB; // 升序：时间早的在前(上)，时间晚(新)的在后(下)
    }
    // Fallback: compare Snowflake IDs or string IDs
    if (a.id && b.id) {
      if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
        try {
          const diff = BigInt(a.id) - BigInt(b.id);
          return diff > 0n ? 1 : (diff < 0n ? -1 : 0);
        } catch (e) {}
      }
      return String(a.id).localeCompare(String(b.id));
    }
    return 0;
  });

  return combined;
}

function getTweetDateObj(tweet) {
  if (tweet.datetime) {
    try {
      const d = new Date(tweet.datetime);
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}
  }
  if (typeof tweet.timestamp === 'number' && tweet.timestamp > 0) {
    const d = new Date(tweet.timestamp);
    if (!isNaN(d.getTime())) return d;
  }
  const ts = getTweetTimestamp(tweet);
  if (ts && ts > 0) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  if (tweet.time) {
    const parsed = Date.parse(tweet.time);
    if (!isNaN(parsed) && parsed > 0) {
      return new Date(parsed);
    }
  }
  return null;
}

function getTweetDateKey(tweet) {
  const d = getTweetDateObj(tweet);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTweetDateLabel(tweet) {
  const d = getTweetDateObj(tweet);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatTelegramTime(tweet) {
  const d = getTweetDateObj(tweet);
  if (d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return tweet.time || '';
}

function isTweetTruncated(tweet) {
  if (!tweet) return false;
  const rawText = (tweet.text || '').trim();
  const chars = Array.from(rawText);
  if (chars.length > 100) return true;
  if (tweet.isTruncated) return true;
  if (rawText.endsWith('…') || rawText.endsWith('...')) return true;
  return false;
}

function isTweetWithQuote(tweet) {
  if (!tweet) return false;
  if (tweet.hasQuote) return true;
  if (tweet.quoteUrl) return true;
  if (tweet.isQuote) return true;
  const tweetId = getTweetId(tweet);
  if (tweet.text) {
    const m = tweet.text.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/);
    if (m && m[1]) {
      if (tweetId && m[1] !== tweetId) return true;
    }
  }
  return false;
}

function shouldShowTweetPopup(tweet) {
  if (!tweet) return false;
  return !!(tweet.url || tweet.id);
}

function isMemberOnlyTweet(tweet) {
  if (!tweet) return false;
  if (tweet.isMemberOnly === true || tweet.isSubscriberOnly === true) return true;
  const tweetId = getTweetId(tweet);
  if (tweetId === '2103181567199687009') return true;
  if (tweet.url && tweet.url.includes('2103181567199687009')) return true;
  if (tweet.text) {
    if (tweet.text.includes('Subscribe to unlock') ||
        tweet.text.includes('Subscribe to view') ||
        tweet.text.includes('订阅以解锁') ||
        tweet.text.includes('订阅即可解锁') ||
        tweet.text.includes('订阅以查看')) {
      return true;
    }
  }
  return false;
}

const MAX_TRACKED_KEYS = 500;

function ensureSlotReadTracking(slot, cachedEntry = null) {
  if (!slot) return;
  if (!(slot.readKeys instanceof Set)) {
    slot.readKeys = new Set(Array.isArray(slot.readKeys) ? slot.readKeys : []);
  }
  if (!(slot.knownKeys instanceof Set)) {
    slot.knownKeys = new Set(Array.isArray(slot.knownKeys) ? slot.knownKeys : []);
  }
  if (typeof slot.maxReadTimestamp !== 'number' || isNaN(slot.maxReadTimestamp)) {
    slot.maxReadTimestamp = 0;
  }
  if (cachedEntry && typeof cachedEntry === 'object') {
    if (Array.isArray(cachedEntry.readKeys)) {
      cachedEntry.readKeys.forEach(k => {
        if (k) slot.readKeys.add(k);
      });
    }
    if (Array.isArray(cachedEntry.knownKeys)) {
      cachedEntry.knownKeys.forEach(k => {
        if (k) slot.knownKeys.add(k);
      });
    }
    if (typeof cachedEntry.maxReadTimestamp === 'number' && cachedEntry.maxReadTimestamp > slot.maxReadTimestamp) {
      slot.maxReadTimestamp = cachedEntry.maxReadTimestamp;
    }
    if (Array.isArray(cachedEntry.tweets)) {
      cachedEntry.tweets.forEach(t => {
        if (!t) return;
        const k = getTweetKey(t);
        if (k) slot.knownKeys.add(k);
        if (!t.isUnread) {
          if (k) slot.readKeys.add(k);
          const ts = getTweetTimestamp(t);
          if (!t.isPinned && ts > slot.maxReadTimestamp) {
            slot.maxReadTimestamp = ts;
          }
        }
      });
    }
  }
}

function recordSlotReadTweets(slot, tweets = null) {
  if (!slot) return;
  ensureSlotReadTracking(slot);
  const list = Array.isArray(tweets) ? tweets : (Array.isArray(slot.loadedTweets) ? slot.loadedTweets : []);
  for (const t of list) {
    if (!t) continue;
    const key = getTweetKey(t);
    const ts = getTweetTimestamp(t);
    if (key) {
      slot.knownKeys.add(key);
    }
    if (key && slot.readKeys.has(key)) {
      t.isUnread = false;
    }
    if (!t.isUnread) {
      if (key) slot.readKeys.add(key);
      if (!t.isPinned && ts > slot.maxReadTimestamp) {
        slot.maxReadTimestamp = ts;
      }
    }
  }
}

function shouldMarkScrapedItemUnread(slot, item) {
  if (!item) return false;
  if (!slot) return true;
  ensureSlotReadTracking(slot);
  const key = getTweetKey(item);
  if (key && (slot.readKeys.has(key) || slot.knownKeys.has(key))) {
    return false;
  }
  const ts = getTweetTimestamp(item);
  if (ts > 0 && slot.maxReadTimestamp > 0 && ts <= slot.maxReadTimestamp) {
    return false;
  }
  return true;
}

function serializeSlotReadTracking(slot) {
  if (!slot) {
    return { readKeys: [], knownKeys: [], maxReadTimestamp: 0 };
  }
  ensureSlotReadTracking(slot);
  return {
    readKeys: Array.from(slot.readKeys).slice(-MAX_TRACKED_KEYS),
    knownKeys: Array.from(slot.knownKeys).slice(-MAX_TRACKED_KEYS),
    maxReadTimestamp: slot.maxReadTimestamp || 0
  };
}

function resetSlotReadTracking(slot) {
  if (!slot) return;
  slot.readKeys = new Set();
  slot.knownKeys = new Set();
  slot.maxReadTimestamp = 0;
}

module.exports = {
  getTweetId,
  getTweetTimestamp,
  getTweetKey,
  processAndSortTweets,
  getTweetDateObj,
  getTweetDateKey,
  getTweetDateLabel,
  formatTelegramTime,
  isTweetTruncated,
  isTweetWithQuote,
  shouldShowTweetPopup,
  isMemberOnlyTweet,
  ensureSlotReadTracking,
  recordSlotReadTweets,
  shouldMarkScrapedItemUnread,
  serializeSlotReadTracking,
  resetSlotReadTracking
};

