const { ipcRenderer } = require('electron');
const { escapeHtml } = require('./utils');
const {
  getTickerHighlightEnabled,
  getTickerFgColor,
  getTickerBgColor,
  getTickerRemoteCache,
  saveTickerRemoteCache
} = require('./storage');
const tickerData = require('../data/ticker-data.json');

const unambiguousSet = new Set(Array.isArray(tickerData.unambiguous) ? tickerData.unambiguous : []);
const contextualSet = new Set(Array.isArray(tickerData.contextual) ? tickerData.contextual : []);
const stopwordsSet = new Set(Array.isArray(tickerData.stopwords) ? tickerData.stopwords : []);

let lastSyncedDate = tickerData.updatedAt || '';

// Trading context indicators in Chinese or English messages for disambiguating contextual tickers
const TRADING_CONTEXT_RE =
  /(?:止盈|止损|建仓|加仓|减仓|清仓|开仓|平仓|做多|做空|看多|看空|看涨|看跌|仓位|底仓|对冲|正股|期权|末日|行权|财报|季报|支撑|压力|阻力|突破|回调|回踩|抄底|追高|目标价|均价|成本|买入|卖出|入场|出场|持仓|\d+\s*股|\bcalls?\b|\bputs?\b)/i;

// Honorifics / suffixes that indicate a person's nickname rather than a ticker (e.g. "pike老师")
const HONORIFIC_AFTER_RE = /^(?:老师|总|哥|姐|大佬|神|叔|爷|博|群|频道)/u;

// Adjacent price / percentage patterns (e.g. "coin 245", "spy 580", "1050以下的mu")
const LOCAL_PRICE_AFTER_RE = /^\s+\d+(?:\.\d+)?(?:\s*%|\s*刀|\s*块|\s*股|\b|$|[，,。！!？?\s])/u;
const LOCAL_PRICE_BEFORE_RE = /\d+(?:\.\d+)?(?:\s*(?:股|刀|块|以下|以上|附近|左右|的))*\s*$/u;

// Single-pass tokenizer:
// Group 1: URLs, domain names, @mentions, #hashtags (passed through without ticker highlighting)
// Group 2: Explicit $TICKER cashtags (1-6 letters + optional .A/.B share class, upper or lower)
// Group 3: Standalone 2-5 letter words (upper or lower, with optional .A/.B share class)
const TOKEN_RE =
  /(https?:\/\/[^\s<>"')\]}\u2018-\u201d\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+|www\.[^\s<>"')\]}\u2018-\u201d\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+|\b[A-Za-z0-9-]+\.(?:com|org|net|io|ai|co|gg|me|dev|app|xyz|tv|us|uk|cn|jp|hk|edu|gov)\b(?:\/[^\s<>"')\]}\u2018-\u201d\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]*)?|[@#][A-Za-z0-9_.-]+)|((?<![A-Za-z0-9_])\$[A-Za-z]{1,6}(?:\.[A-Za-z])?(?![A-Za-z0-9_]))|((?<![A-Za-z0-9_$@#-])[A-Za-z]{2,5}(?:\.[ABab])?(?![A-Za-z0-9_-]))/g;

function loadCachedRemoteSymbols() {
  const cached = getTickerRemoteCache();
  if (!cached || !Array.isArray(cached.symbols)) return 0;
  let added = 0;
  for (const sym of cached.symbols) {
    const upper = String(sym || '').trim().toUpperCase();
    if (upper && !stopwordsSet.has(upper) && !contextualSet.has(upper) && !unambiguousSet.has(upper)) {
      unambiguousSet.add(upper);
      added++;
    }
  }
  if (cached.updatedAt) {
    try {
      lastSyncedDate = new Date(cached.updatedAt).toISOString().slice(0, 10);
    } catch (e) {}
  }
  return added;
}

function applyTickerColors(customFg, customBg) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const fg = customFg || getTickerFgColor();
  const bg = customBg || getTickerBgColor();
  document.documentElement.style.setProperty('--ticker-fg-color', fg);
  document.documentElement.style.setProperty('--ticker-bg-color', bg);
}

function isWordTicker(word, rawText, offset, hasTradingContext) {
  const afterStr = rawText.slice(offset + word.length);
  if (HONORIFIC_AFTER_RE.test(afterStr)) return false;

  const upper = word.toUpperCase();
  if (upper === 'BRK.A' || upper === 'BRK.B' || unambiguousSet.has(upper)) {
    return true;
  }

  if (contextualSet.has(upper)) {
    const beforeStr = rawText.slice(Math.max(0, offset - 20), offset);
    if (
      hasTradingContext ||
      LOCAL_PRICE_AFTER_RE.test(afterStr) ||
      LOCAL_PRICE_BEFORE_RE.test(beforeStr)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Safely HTML-escapes plain text while wrapping recognized stock/ETF/crypto tickers
 * (both uppercase and lowercase, with or without `$`) in `<span class="ticker-highlight">`,
 * and optionally converting URLs into clickable `<a class="popup-inline-link">` elements.
 */
function formatTextWithTickers(rawText, contextText, options = {}) {
  const str = String(rawText || '');
  if (!str) return '';
  const linkifyUrls = !!(options && options.linkifyUrls);
  const highlightTickers = getTickerHighlightEnabled();
  if (!highlightTickers && !linkifyUrls) {
    return escapeHtml(str);
  }

  const fullContext = contextText ? String(contextText) : str;
  const hasTradingContext = highlightTickers ? TRADING_CONTEXT_RE.test(fullContext) : false;
  let result = '';
  let lastIndex = 0;

  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(str)) !== null) {
    const fullMatch = match[0];
    const urlOrHandle = match[1];
    const cashtag = match[2];
    const word = match[3];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      result += escapeHtml(str.slice(lastIndex, matchIndex));
    }

    if (urlOrHandle) {
      const isHandleOrTag = urlOrHandle[0] === '@' || urlOrHandle[0] === '#';
      if (linkifyUrls && !isHandleOrTag) {
        const trailingMatch = urlOrHandle.match(/[.,;:!?]+$/);
        const cleanUrl = trailingMatch
          ? urlOrHandle.slice(0, -trailingMatch[0].length)
          : urlOrHandle;
        const trailingPunct = trailingMatch ? trailingMatch[0] : '';
        const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
        result += `<a href="#" class="popup-inline-link" data-url="${escapeHtml(href)}">${escapeHtml(cleanUrl)}</a>${escapeHtml(trailingPunct)}`;
      } else {
        result += escapeHtml(fullMatch);
      }
    } else if (highlightTickers && cashtag) {
      result += `<span class="ticker-highlight">${escapeHtml(cashtag)}</span>`;
    } else if (highlightTickers && word && isWordTicker(word, str, matchIndex, hasTradingContext)) {
      result += `<span class="ticker-highlight">${escapeHtml(word)}</span>`;
    } else {
      result += escapeHtml(fullMatch);
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < str.length) {
    result += escapeHtml(str.slice(lastIndex));
  }

  return result;
}

async function syncOnlineTickers({ force = false, onUpdated } = {}) {
  if (!ipcRenderer) return { ok: false, error: 'IPC unavailable' };

  if (!force && unambiguousSet.size > 0) {
    return {
      ok: true,
      cached: true,
      totalCount: unambiguousSet.size + contextualSet.size,
      updatedAt: lastSyncedDate
    };
  }

  try {
    const res = await ipcRenderer.invoke('fetch-online-tickers');
    if (res && res.ok && Array.isArray(res.symbols)) {
      let newlyAdded = 0;
      for (const sym of res.symbols) {
        const upper = String(sym || '').trim().toUpperCase();
        if (upper && !stopwordsSet.has(upper) && !contextualSet.has(upper) && !unambiguousSet.has(upper)) {
          unambiguousSet.add(upper);
          newlyAdded++;
        }
      }
      const now = Date.now();
      lastSyncedDate = res.updatedAt || new Date(now).toISOString().slice(0, 10);
      saveTickerRemoteCache({
        updatedAt: now,
        symbols: Array.from(unambiguousSet)
      });
      if (newlyAdded > 0 && typeof onUpdated === 'function') {
        onUpdated(newlyAdded);
      }
      return {
        ok: true,
        newlyAdded,
        totalCount: unambiguousSet.size + contextualSet.size,
        updatedAt: lastSyncedDate
      };
    }
    return { ok: false, error: (res && res.error) || 'Failed to fetch online tickers' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getTickerStats() {
  return {
    totalCount: unambiguousSet.size + contextualSet.size,
    updatedAt: lastSyncedDate
  };
}

function initTickers({ onUpdated } = {}) {
  applyTickerColors();
  loadCachedRemoteSymbols();
  // Only fetch online automatically if the local ticker dictionary is empty;
  // all fetched tickers are persisted permanently in data/ticker-data.json.
  if (unambiguousSet.size === 0) {
    setTimeout(() => {
      syncOnlineTickers({ force: true, onUpdated });
    }, 3000);
  }
}

module.exports = {
  initTickers,
  applyTickerColors,
  formatTextWithTickers,
  syncOnlineTickers,
  getTickerStats
};
