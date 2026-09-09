function getTweetId(tweet) {
  if (tweet.id) return String(tweet.id);
  if (tweet.url) {
    const m = String(tweet.url).match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  return '';
}

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
      return Number((BigInt(id) >> 22n) + 1288834974657n);
    } catch (e) {}
  }
  return 0;
}

function getTweetKey(tweet) {
  const id = getTweetId(tweet);
  if (id) return `id_${id}`;
  if (tweet.url) return `url_${tweet.url}`;
  return `txt_${(tweet.text || '').slice(0, 40)}_${tweet.time || ''}`;
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

module.exports = {
  getTweetId,
  getTweetTimestamp,
  getTweetKey,
  processAndSortTweets,
  getTweetDateObj,
  getTweetDateKey,
  getTweetDateLabel,
  formatTelegramTime
};
