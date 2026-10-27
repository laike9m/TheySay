const { ipcRenderer } = require('electron');
const { escapeHtml } = require('./utils');
const {
  getTickerFgColor,
  getTickerBgColor,
  getTickerRemoteCache,
  saveTickerRemoteCache,
  getUrlTitlesCache,
  saveUrlTitlesCache
} = require('./storage');
const tickerData = require('../../data/ticker-data.json');

const unambiguousSet = new Set(Array.isArray(tickerData.unambiguous) ? tickerData.unambiguous : []);
const contextualSet = new Set(Array.isArray(tickerData.contextual) ? tickerData.contextual : []);
const stopwordsSet = new Set(Array.isArray(tickerData.stopwords) ? tickerData.stopwords : []);

let lastSyncedDate = tickerData.updatedAt || '';

const MAX_CACHED_URL_TITLES = 1000;
const TRACKING_QUERY_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'r',
  'showWelcomeOnShare',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  's',
  't',
  'si',
  'feature',
  'ref',
  'ref_src',
  'ref_url'
];

const urlTitleMemoryCache = new Map();
const inFlightUrlTitleRequests = new Map();
const failedUrlTitleSet = new Set();
let urlTitleCacheHydrated = false;

// Trading context indicators in Chinese or English messages for disambiguating contextual tickers
const TRADING_CONTEXT_RE =
  /(?:止盈|止损|建仓|加仓|减仓|清仓|开仓|平仓|做多|做空|看多|看空|看涨|看跌|仓位|底仓|对冲|正股|期权|末日|行权|财报|季报|支撑|压力|阻力|突破|回调|回踩|抄底|追高|目标价|均价|成本|买入|卖出|入场|出场|持仓|\d+\s*股|\bcalls?\b|\bputs?\b)/i;

// Honorifics / suffixes that indicate a person's nickname rather than a ticker (e.g. "pike老师")
const HONORIFIC_AFTER_RE = /^(?:老师|总|哥|姐|大佬|神|叔|爷|博|群|频道)/u;

// Adjacent price / percentage patterns (e.g. "coin 245", "spy 580", "1050以下的mu")
const LOCAL_PRICE_AFTER_RE = /^\s+\d+(?:\.\d+)?(?:\s*%|\s*刀|\s*块|\s*股|\b|$|[，,。.！!？?\s])/u;
const LOCAL_PRICE_BEFORE_RE = /\d+(?:\.\d+)?(?:\s*(?:股|刀|块|以下|以上|附近|左右|的))*\s*$/u;

// Single-pass tokenizer:
// Group 1: URLs, domain names, @mentions, #hashtags (passed through without ticker highlighting)
// Group 2: Explicit $TICKER cashtags (1-6 letters + optional .A/.B share class, upper or lower)
// Group 3: Standalone 2-5 letter words (upper or lower, with optional .A/.B share class)
const TOKEN_RE =
  /(https?:\/\/[^\s<>"')\]}\u2018-\u201d\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+|www\.[^\s<>"')\]}\u2018-\u201d\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+|\b[A-Za-z0-9-]+\.(?:com|org|net|io|ai|co|gg|me|dev|app|xyz|tv|us|uk|cn|jp|hk|edu|gov)\b(?:\/[^\s<>"')\]}\u2018-\u201d\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]*)?|[@#][A-Za-z0-9_.-]+)|((?<![A-Za-z0-9_])\$[A-Za-z]{1,6}(?:\.[A-Za-z](?![A-Za-z0-9_]))?(?![A-Za-z0-9_]))|((?<![A-Za-z0-9_$@#-])[A-Za-z]{2,5}(?:\.[ABab](?![A-Za-z0-9_-]))?(?![A-Za-z0-9_-]))/g;

function splitUrlToken(urlOrHandle) {
  const raw = String(urlOrHandle || '');
  const trailingMatch = raw.match(/[.,;:!?]+$/);
  const cleanUrl = trailingMatch ? raw.slice(0, -trailingMatch[0].length) : raw;
  const trailingPunct = trailingMatch ? trailingMatch[0] : '';
  const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
  return { cleanUrl, trailingPunct, href };
}

function isWebLinkToken(cleanUrl) {
  if (!cleanUrl || cleanUrl[0] === '@' || cleanUrl[0] === '#') return false;
  if (/^https?:\/\//i.test(cleanUrl) || /^www\./i.test(cleanUrl)) return true;
  return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/[^\s]+/i.test(cleanUrl);
}

function normalizeUrlForTitleKey(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const { cleanUrl, href } = splitUrlToken(rawUrl.trim());
  if (!cleanUrl) return '';
  try {
    const u = new URL(href);
    return u.toString();
  } catch (_) {
    return href;
  }
}

function getCanonicalUrlForTitleKey(rawUrl) {
  const norm = normalizeUrlForTitleKey(rawUrl);
  if (!norm) return '';
  try {
    const u = new URL(norm);
    for (const param of TRACKING_QUERY_PARAMS) {
      u.searchParams.delete(param);
    }
    u.hash = '';
    const str = u.toString();
    return str.endsWith('/') && u.pathname === '/' ? str.slice(0, -1) : str;
  } catch (_) {
    return norm;
  }
}

function cleanUrlTitleString(rawTitle, rawUrl = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  const cleaned = rawTitle
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^https?:\/\/\S+$/i.test(cleaned)) return '';
  if (rawUrl && cleaned.toLowerCase() === String(rawUrl).trim().toLowerCase()) return '';
  return cleaned;
}

function ensureUrlTitleCacheHydrated() {
  if (urlTitleCacheHydrated) return;
  urlTitleCacheHydrated = true;
  try {
    const stored = getUrlTitlesCache();
    if (stored && typeof stored === 'object') {
      for (const [k, v] of Object.entries(stored)) {
        const cleaned = cleanUrlTitleString(v, k);
        if (k && cleaned) {
          urlTitleMemoryCache.set(k, cleaned);
        }
      }
    }
  } catch (_) {}
}

function persistUrlTitleCacheToStorage() {
  try {
    const entries = Array.from(urlTitleMemoryCache.entries()).slice(-MAX_CACHED_URL_TITLES);
    const obj = {};
    for (const [k, v] of entries) {
      obj[k] = v;
    }
    saveUrlTitlesCache(obj);
  } catch (_) {}
}

function registerUrlTitle(rawUrl, rawTitle, { persist = true } = {}) {
  ensureUrlTitleCacheHydrated();
  const { cleanUrl } = splitUrlToken(String(rawUrl || '').trim());
  const title = cleanUrlTitleString(rawTitle, cleanUrl);
  if (!cleanUrl || !title) return false;

  const normKey = normalizeUrlForTitleKey(cleanUrl);
  const canonKey = getCanonicalUrlForTitleKey(cleanUrl);
  let changed = false;

  for (const key of [cleanUrl, normKey, canonKey]) {
    if (key && urlTitleMemoryCache.get(key) !== title) {
      urlTitleMemoryCache.set(key, title);
      failedUrlTitleSet.delete(key);
      changed = true;
    }
  }

  if (changed && persist) {
    persistUrlTitleCacheToStorage();
  }
  return changed;
}

function registerUrlTitlesMap(mapObj, { persist = true } = {}) {
  if (!mapObj || typeof mapObj !== 'object') return false;
  let anyChanged = false;
  for (const [url, title] of Object.entries(mapObj)) {
    if (registerUrlTitle(url, title, { persist: false })) {
      anyChanged = true;
    }
  }
  if (anyChanged && persist) {
    persistUrlTitleCacheToStorage();
  }
  return anyChanged;
}

function lookupTitleInObject(mapObj, cleanUrl, normKey, canonKey) {
  if (!mapObj || typeof mapObj !== 'object') return '';
  const direct = mapObj[cleanUrl] || mapObj[normKey] || mapObj[canonKey];
  if (direct) {
    const cleaned = cleanUrlTitleString(direct, cleanUrl);
    if (cleaned) return cleaned;
  }
  for (const [k, v] of Object.entries(mapObj)) {
    if (!v) continue;
    if (getCanonicalUrlForTitleKey(k) === canonKey || normalizeUrlForTitleKey(k) === normKey) {
      const cleaned = cleanUrlTitleString(v, cleanUrl);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

function getCachedUrlTitle(rawUrl, extraTitlesMap = null) {
  const { cleanUrl } = splitUrlToken(String(rawUrl || '').trim());
  if (!cleanUrl || !isWebLinkToken(cleanUrl)) return '';

  const normKey = normalizeUrlForTitleKey(cleanUrl);
  const canonKey = getCanonicalUrlForTitleKey(cleanUrl);

  if (extraTitlesMap && typeof extraTitlesMap === 'object') {
    const fromExtra = lookupTitleInObject(extraTitlesMap, cleanUrl, normKey, canonKey);
    if (fromExtra) return fromExtra;
  }

  if (typeof window !== 'undefined' && window.__THEYSAY_MOCK_URL_TITLES) {
    if (typeof window.__THEYSAY_MOCK_URL_TITLES === 'function') {
      const res = cleanUrlTitleString(window.__THEYSAY_MOCK_URL_TITLES(cleanUrl), cleanUrl);
      if (res) return res;
    } else if (typeof window.__THEYSAY_MOCK_URL_TITLES === 'object') {
      const res = lookupTitleInObject(window.__THEYSAY_MOCK_URL_TITLES, cleanUrl, normKey, canonKey);
      if (res) return res;
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const rawMock = localStorage.getItem('theysay_mock_url_titles');
      if (rawMock) {
        const parsedMock = JSON.parse(rawMock);
        const res = lookupTitleInObject(parsedMock, cleanUrl, normKey, canonKey);
        if (res) return res;
      }
    } catch (_) {}
  }

  ensureUrlTitleCacheHydrated();
  return (
    urlTitleMemoryCache.get(cleanUrl) ||
    urlTitleMemoryCache.get(normKey) ||
    urlTitleMemoryCache.get(canonKey) ||
    ''
  );
}

function extractUrlsFromText(rawText) {
  const str = String(rawText || '');
  if (!str) return [];
  const urls = [];
  const seen = new Set();
  const re = new RegExp(TOKEN_RE.source, 'g');
  let match;
  while ((match = re.exec(str)) !== null) {
    const urlOrHandle = match[1];
    if (!urlOrHandle) continue;
    const { cleanUrl } = splitUrlToken(urlOrHandle);
    if (isWebLinkToken(cleanUrl) && !seen.has(cleanUrl)) {
      seen.add(cleanUrl);
      urls.push(cleanUrl);
    }
  }
  return urls;
}

function replaceUrlsWithTitles(rawText, extraTitlesMap = null) {
  const str = String(rawText || '');
  if (!str) return '';
  const re = new RegExp(TOKEN_RE.source, 'g');
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = re.exec(str)) !== null) {
    const fullMatch = match[0];
    const urlOrHandle = match[1];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      result += str.slice(lastIndex, matchIndex);
    }

    if (urlOrHandle) {
      const { cleanUrl, trailingPunct } = splitUrlToken(urlOrHandle);
      if (isWebLinkToken(cleanUrl)) {
        const title = getCachedUrlTitle(cleanUrl, extraTitlesMap);
        result += `${title || cleanUrl}${trailingPunct}`;
      } else {
        result += fullMatch;
      }
    } else {
      result += fullMatch;
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < str.length) {
    result += str.slice(lastIndex);
  }

  return result;
}

function trimIncompletePlainToken(sliceStr, fullPlainStr) {
  if (sliceStr.length >= fullPlainStr.length) return sliceStr;
  const nextChar = fullPlainStr[sliceStr.length];
  if (!nextChar || /\s/.test(nextChar)) return sliceStr;
  const m = sliceStr.match(/([$@#]?[A-Za-z0-9_.-]+)$/);
  if (!m) return sliceStr;
  const partialToken = m[1];
  const beforeToken = sliceStr.slice(0, sliceStr.length - partialToken.length);
  const lastNewlineIdx = beforeToken.lastIndexOf('\n');
  const lineContentBefore = beforeToken.slice(lastNewlineIdx + 1).trim();
  if (lineContentBefore.length > 0 && partialToken.length <= 15) {
    return beforeToken.trimEnd();
  }
  return sliceStr;
}

/**
 * Slices `rawText` to at most `maxDisplayChars` visible characters, where each web URL
 * is counted by the character length of its resolved webpage title rather than its raw URL
 * string, and every URL token in `slicedText` remains intact so `formatTextWithTickers`
 * never receives a half-sliced URL.
 */
function sliceTextWithUrlTitles(rawText, maxDisplayChars, extraTitlesMap = null) {
  const str = String(rawText || '');
  if (!str || typeof maxDisplayChars !== 'number' || maxDisplayChars <= 0) {
    return { slicedText: '', linkTitles: extraTitlesMap || null };
  }

  const re = new RegExp(TOKEN_RE.source, 'g');
  let remaining = maxDisplayChars;
  let slicedText = '';
  let lastIndex = 0;
  let overrideTitles = null;
  let stoppedEarly = false;
  let match;

  const appendPlainSlice = (plainSeg) => {
    if (!plainSeg || remaining <= 0) return;
    const chars = Array.from(plainSeg);
    if (chars.length <= remaining) {
      slicedText += plainSeg;
      remaining -= chars.length;
    } else {
      const partial = chars.slice(0, remaining).join('');
      slicedText += trimIncompletePlainToken(partial, plainSeg);
      remaining = 0;
      stoppedEarly = true;
    }
  };

  while ((match = re.exec(str)) !== null) {
    const fullMatch = match[0];
    const urlOrHandle = match[1];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      appendPlainSlice(str.slice(lastIndex, matchIndex));
      if (stoppedEarly) break;
    }

    if (urlOrHandle) {
      const { cleanUrl, trailingPunct } = splitUrlToken(urlOrHandle);
      if (isWebLinkToken(cleanUrl)) {
        if (remaining <= 0) {
          stoppedEarly = true;
          break;
        }
        const resolvedTitle = getCachedUrlTitle(cleanUrl, extraTitlesMap);
        const displayLabel = resolvedTitle || cleanUrl;
        const labelChars = Array.from(displayLabel);

        if (labelChars.length <= remaining) {
          slicedText += cleanUrl;
          remaining -= labelChars.length;
          if (trailingPunct) {
            const pChars = Array.from(trailingPunct);
            if (pChars.length <= remaining) {
              slicedText += trailingPunct;
              remaining -= pChars.length;
            } else {
              slicedText += pChars.slice(0, remaining).join('');
              remaining = 0;
              stoppedEarly = true;
              break;
            }
          }
        } else {
          const partialLabel = labelChars.slice(0, remaining).join('').trimEnd();
          if (partialLabel) {
            slicedText += cleanUrl;
            overrideTitles = Object.assign({}, extraTitlesMap || {}, {
              [cleanUrl]: partialLabel
            });
          }
          remaining = 0;
          stoppedEarly = true;
          break;
        }
        lastIndex = matchIndex + fullMatch.length;
        continue;
      }
    }

    appendPlainSlice(fullMatch);
    lastIndex = matchIndex + fullMatch.length;
    if (stoppedEarly) break;
  }

  if (!stoppedEarly && lastIndex < str.length && remaining > 0) {
    appendPlainSlice(str.slice(lastIndex));
  }

  return {
    slicedText: slicedText.trimEnd(),
    linkTitles: overrideTitles || extraTitlesMap || null
  };
}

async function fetchUrlTitle(rawUrl) {
  const { cleanUrl, href } = splitUrlToken(String(rawUrl || '').trim());
  if (!cleanUrl || !isWebLinkToken(cleanUrl)) return '';

  const existing = getCachedUrlTitle(cleanUrl);
  if (existing) {
    registerUrlTitle(cleanUrl, existing);
    return existing;
  }

  const canonKey = getCanonicalUrlForTitleKey(cleanUrl);
  if (failedUrlTitleSet.has(canonKey)) {
    return '';
  }

  if (inFlightUrlTitleRequests.has(canonKey)) {
    return inFlightUrlTitleRequests.get(canonKey);
  }

  const promise = (async () => {
    try {
      if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
        return '';
      }
      const res = await ipcRenderer.invoke('fetch-url-title', href);
      if (res && res.ok && res.title) {
        const cleaned = cleanUrlTitleString(res.title, cleanUrl);
        if (cleaned) {
          registerUrlTitle(cleanUrl, cleaned);
          if (res.finalUrl && res.finalUrl !== href) {
            registerUrlTitle(res.finalUrl, cleaned);
          }
          return cleaned;
        }
      }
      failedUrlTitleSet.add(canonKey);
      return '';
    } catch (_) {
      failedUrlTitleSet.add(canonKey);
      return '';
    } finally {
      inFlightUrlTitleRequests.delete(canonKey);
    }
  })();

  inFlightUrlTitleRequests.set(canonKey, promise);
  return promise;
}

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
 * and rendering URLs with their resolved webpage title instead of the raw URL string.
 */
function formatTextWithTickers(rawText, contextText, options = {}) {
  const str = String(rawText || '');
  if (!str) return '';
  const linkifyUrls = !!(options && options.linkifyUrls);
  const extraTitlesMap = (options && options.linkTitles) || null;

  const fullContext = contextText ? String(contextText) : str;
  const hasTradingContext = TRADING_CONTEXT_RE.test(fullContext);
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
      const { cleanUrl, trailingPunct, href } = splitUrlToken(urlOrHandle);
      if (isWebLinkToken(cleanUrl)) {
        const resolvedTitle = getCachedUrlTitle(cleanUrl, extraTitlesMap);
        const displayLabel = resolvedTitle || cleanUrl;
        if (linkifyUrls) {
          result += `<a href="#" class="popup-inline-link" data-url="${escapeHtml(href)}" data-raw-url="${escapeHtml(cleanUrl)}" title="${escapeHtml(href)}">${escapeHtml(displayLabel)}</a>${escapeHtml(trailingPunct)}`;
        } else {
          result += `<span class="im-inline-link" data-url="${escapeHtml(href)}" data-raw-url="${escapeHtml(cleanUrl)}" title="${escapeHtml(href)}">${escapeHtml(displayLabel)}</span>${escapeHtml(trailingPunct)}`;
        }
      } else {
        result += escapeHtml(fullMatch);
      }
    } else if (cashtag) {
      result += `<span class="ticker-highlight">${escapeHtml(cashtag)}</span>`;
    } else if (word && isWordTicker(word, str, matchIndex, hasTradingContext)) {
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
  ensureUrlTitleCacheHydrated();
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
  getTickerStats,
  registerUrlTitle,
  registerUrlTitlesMap,
  getCachedUrlTitle,
  extractUrlsFromText,
  replaceUrlsWithTitles,
  sliceTextWithUrlTitles,
  fetchUrlTitle
};
