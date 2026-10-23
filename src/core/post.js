function getPostId(post) {
  if (!post) return '';
  if (post.id) return String(post.id);
  if (post.url) {
    const m = String(post.url).match(/\/status\/(\d+)/);
    if (m) return m[1];
    const tm = String(post.url).match(/\/post\/([A-Za-z0-9_-]+)/);
    if (tm) return tm[1];
  }
  return '';
}

// Snowflake epochs: Twitter counts from 2010-11-04, Discord from 2015-01-01.
const TWITTER_EPOCH = 1288834974657n;
const DISCORD_EPOCH = 1420070400000n;

function getPostTimestamp(post) {
  if (typeof post.timestamp === 'number' && post.timestamp > 0) {
    return post.timestamp;
  }
  if (post.datetime) {
    const parsed = Date.parse(post.datetime);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const id = getPostId(post);
  if (id && /^\d+$/.test(id)) {
    try {
      const epoch = post.source === 'discord' ? DISCORD_EPOCH : TWITTER_EPOCH;
      return Number((BigInt(id) >> 22n) + epoch);
    } catch (e) {}
  }
  return 0;
}

function getPostKey(post) {
  if (!post) return '';
  const prefix = post.source === 'discord'
    ? 'discord_'
    : (post.source === 'threads' ? 'threads_' : '');
  const id = getPostId(post);
  if (id) return `${prefix}id_${id}`;
  if (post.url) return `${prefix}url_${post.url}`;
  return `${prefix}txt_${(post.text || '').slice(0, 40)}_${post.datetime || post.time || ''}`;
}

function cleanInlineEntityNewlines(text) {
  if (typeof text !== 'string' || !text.includes('\n')) return text;
  let cleaned = text;
  let prev;
  do {
    prev = cleaned;
    // 1. Entity ($TICKER, #hashtag, @handle) on its own line between inline text segments
    //    where the line after starts with horizontal space or inline punctuation:
    //    e.g. "Long term\n$QQQ\n model" -> "Long term $QQQ model"
    cleaned = cleaned.replace(
      /([^\r\n])[ \t]*\r?\n([$@#][A-Za-z0-9_.]+)\r?\n(?:[ \t]+([^\r\n])|([,.;:!?)}\]]))/g,
      (_, beforeChar, entity, afterSpaceChar, afterPunct) => {
        const prefix = /[([{'"“‘]/.test(beforeChar) ? `${beforeChar}${entity}` : `${beforeChar} ${entity}`;
        return afterPunct ? `${prefix}${afterPunct}` : `${prefix} ${afterSpaceChar}`;
      }
    );
    // 2. Entity followed by "\n <text>" (single newline + leading horizontal space) or "\n<punct>":
    //    e.g. "$QQQ\n model continues" -> "$QQQ model continues"
    cleaned = cleaned.replace(
      /([$@#][A-Za-z0-9_.]+)\r?\n(?:[ \t]+([^\r\n])|([,.;:!?)}\]]))/g,
      (_, entity, afterSpaceChar, afterPunct) => {
        return afterPunct ? `${entity}${afterPunct}` : `${entity} ${afterSpaceChar}`;
      }
    );
    // 3. Inline text ending with explicit horizontal space or opening bracket before "\n$ENTITY":
    cleaned = cleaned.replace(
      /([^\r\n\s])([ \t]+)\r?\n([$@#][A-Za-z0-9_.]+)/g,
      '$1 $3'
    );
    cleaned = cleaned.replace(
      /([([{'"“‘])[ \t]*\r?\n([$@#][A-Za-z0-9_.]+)/g,
      '$1$2'
    );
  } while (cleaned !== prev);
  return cleaned;
}

function processAndSortPosts(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return [];

  // 1. Ensure id, timestamp, cleaned text, and isMemberOnly are calculated
  const normalized = posts.map(p => ({
    ...p,
    id: getPostId(p),
    text: typeof p.text === 'string' ? cleanInlineEntityNewlines(p.text) : p.text,
    timestamp: getPostTimestamp(p),
    isMemberOnly: isMemberOnlyPost(p)
  }));

  // 2. Deduplicate by unique key (preserving isUnread: false and backfilled fields)
  const uniqueMap = new Map();
  for (const p of normalized) {
    const key = getPostKey(p);
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, p);
    } else {
      const prev = uniqueMap.get(key);
      if (prev.isUnread === false || p.isUnread === false) {
        prev.isUnread = false;
      }
      if (!prev.avatarUrl && p.avatarUrl) prev.avatarUrl = p.avatarUrl;
      if (p.hasQuote && !prev.hasQuote) prev.hasQuote = true;
      if (p.quoteUrl && !prev.quoteUrl) prev.quoteUrl = p.quoteUrl;
      if (p.quoteAuthor && !prev.quoteAuthor) prev.quoteAuthor = p.quoteAuthor;
      if (p.quoteText && !prev.quoteText) prev.quoteText = p.quoteText;
      if (Array.isArray(p.images) && p.images.length > 0 && (!Array.isArray(prev.images) || prev.images.length === 0)) {
        prev.images = p.images;
      }
      if (p.imagesBackfilled && !prev.imagesBackfilled) {
        prev.imagesBackfilled = true;
      }
      if (Array.isArray(p.attachments) && p.attachments.length > 0 && (!Array.isArray(prev.attachments) || prev.attachments.length === 0)) {
        prev.attachments = p.attachments;
      }
    }
  }
  const uniquePosts = Array.from(uniqueMap.values());

  // 3. Separate non-pinned and pinned posts
  const nonPinned = uniquePosts.filter(p => !p.isPinned);
  const pinned = uniquePosts.filter(p => p.isPinned);

  // 4. "如果置顶的帖子比最老的帖子还老，那就不显示它"
  let validPinned = [];
  if (nonPinned.length > 0) {
    let oldestNonPinnedTime = Infinity;
    for (const p of nonPinned) {
      if (p.timestamp > 0 && p.timestamp < oldestNonPinnedTime) {
        oldestNonPinnedTime = p.timestamp;
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

  // 5. "从上到下是从旧到新（升序排序，最新帖子在最下面）"
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

function getPostDateObj(post) {
  if (post.datetime) {
    try {
      const d = new Date(post.datetime);
      if (!isNaN(d.getTime())) return d;
    } catch (e) {}
  }
  if (typeof post.timestamp === 'number' && post.timestamp > 0) {
    const d = new Date(post.timestamp);
    if (!isNaN(d.getTime())) return d;
  }
  const ts = getPostTimestamp(post);
  if (ts && ts > 0) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  if (post.time) {
    const parsed = Date.parse(post.time);
    if (!isNaN(parsed) && parsed > 0) {
      return new Date(parsed);
    }
  }
  return null;
}

function getPostDateKey(post) {
  const d = getPostDateObj(post);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPostDateLabel(post) {
  const d = getPostDateObj(post);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatTelegramTime(post) {
  const d = getPostDateObj(post);
  if (d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return post.time || '';
}

function isPostTruncated(post) {
  if (!post) return false;
  const rawText = (post.text || '').trim();
  const chars = Array.from(rawText);
  if (chars.length > 100) return true;
  if (post.isTruncated) return true;
  if (rawText.endsWith('…') || rawText.endsWith('...')) return true;
  return false;
}

function isPostWithQuote(post) {
  if (!post) return false;
  if (post.hasQuote) return true;
  if (post.quoteUrl) return true;
  if (post.isQuote) return true;
  const postId = getPostId(post);
  if (post.text) {
    const m = post.text.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/);
    if (m && m[1]) {
      if (postId && m[1] !== postId) return true;
    }
  }
  return false;
}

function shouldShowPostPopup(post) {
  if (!post) return false;
  return !!(post.url || post.id);
}

function isMemberOnlyPost(post) {
  if (!post) return false;
  if (post.isMemberOnly === true || post.isSubscriberOnly === true) return true;
  const postId = getPostId(post);
  if (postId === '2103181567199687009') return true;
  if (post.url && post.url.includes('2103181567199687009')) return true;
  if (post.text) {
    if (post.text.includes('Subscribe to unlock') ||
        post.text.includes('Subscribe to view') ||
        post.text.includes('订阅以解锁') ||
        post.text.includes('订阅即可解锁') ||
        post.text.includes('订阅以查看')) {
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
    const cachedPosts = Array.isArray(cachedEntry.posts)
      ? cachedEntry.posts
      : (Array.isArray(cachedEntry.tweets) ? cachedEntry.tweets : []);
    if (cachedPosts.length > 0) {
      cachedPosts.forEach(p => {
        if (!p) return;
        const k = getPostKey(p);
        if (k) slot.knownKeys.add(k);
        if (!p.isUnread) {
          if (k) slot.readKeys.add(k);
          const ts = getPostTimestamp(p);
          if (!p.isPinned && ts > slot.maxReadTimestamp) {
            slot.maxReadTimestamp = ts;
          }
        }
      });
    }
  }
}

function recordSlotReadPosts(slot, posts = null) {
  if (!slot) return;
  ensureSlotReadTracking(slot);
  const list = Array.isArray(posts) ? posts : (Array.isArray(slot.loadedPosts) ? slot.loadedPosts : []);
  for (const p of list) {
    if (!p) continue;
    const key = getPostKey(p);
    const ts = getPostTimestamp(p);
    if (key) {
      slot.knownKeys.add(key);
    }
    if (key && slot.readKeys.has(key)) {
      p.isUnread = false;
    }
    if (!p.isUnread) {
      if (key) slot.readKeys.add(key);
      if (!p.isPinned && ts > slot.maxReadTimestamp) {
        slot.maxReadTimestamp = ts;
      }
    }
  }
}

function shouldMarkScrapedItemUnread(slot, item) {
  if (!item) return false;
  if (!slot) return true;
  ensureSlotReadTracking(slot);
  const key = getPostKey(item);
  if (key && (slot.readKeys.has(key) || slot.knownKeys.has(key))) {
    return false;
  }
  const ts = getPostTimestamp(item);
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
  getPostId,
  getPostTimestamp,
  getPostKey,
  cleanInlineEntityNewlines,
  processAndSortPosts,
  getPostDateObj,
  getPostDateKey,
  getPostDateLabel,
  formatTelegramTime,
  isPostTruncated,
  isPostWithQuote,
  shouldShowPostPopup,
  isMemberOnlyPost,
  ensureSlotReadTracking,
  recordSlotReadPosts,
  shouldMarkScrapedItemUnread,
  serializeSlotReadTracking,
  resetSlotReadTracking
};


