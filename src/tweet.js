function getTweetId(tweet) {
  if (tweet.id) return String(tweet.id);
  if (tweet.url) {
    const m = String(tweet.url).match(/\/status\/(\d+)/);
    if (m) return m[1];
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
  if (id) {
    try {
      const epoch = tweet.source === 'discord' ? DISCORD_EPOCH : TWITTER_EPOCH;
      return Number((BigInt(id) >> 22n) + epoch);
    } catch (e) {}
  }
  return 0;
}

function getTweetKey(tweet) {
  const prefix = tweet.source ? `${tweet.source}_` : '';
  const id = getTweetId(tweet);
  if (id) return `${prefix}id_${id}`;
  if (tweet.url) return `${prefix}url_${tweet.url}`;
  return `${prefix}txt_${(tweet.text || '').slice(0, 40)}_${tweet.time || ''}`;
}

function processAndSortTweets(tweets) {
  if (!Array.isArray(tweets) || tweets.length === 0) return [];

  // 1. Ensure id and timestamp are calculated
  const normalized = tweets.map(t => ({
    ...t,
    id: getTweetId(t),
    timestamp: getTweetTimestamp(t)
  }));

  // 2. Deduplicate by unique key
  const uniqueMap = new Map();
  for (const t of normalized) {
    const key = getTweetKey(t);
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, t);
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
    // Fallback: compare Snowflake IDs
    if (a.id && b.id) {
      try {
        const diff = BigInt(a.id) - BigInt(b.id);
        return diff > 0n ? 1 : (diff < 0n ? -1 : 0);
      } catch (e) {}
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
  shouldShowTweetPopup
};

