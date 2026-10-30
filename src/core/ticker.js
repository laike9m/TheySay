const { ipcRenderer } = require('electron');
const LinkifyIt = require('linkify-it');
const tlds = require('tlds');
const normalizeUrl = require('normalize-url');
const { LRUCache } = require('lru-cache');
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

const linkify = new LinkifyIt({}, { fuzzyLink: true, fuzzyEmail: true, fuzzyIP: false });
linkify.tlds(tlds);
linkify.add('ftp:', null);
linkify.add('//', null);
linkify.add('@', { validate: /^[A-Za-z0-9_.-]+/ });
linkify.add('#', { validate: /^[A-Za-z0-9_.-]+/ });

const unambiguousSet = new Set(Array.isArray(tickerData.unambiguous) ? tickerData.unambiguous : []);
const contextualSet = new Set(Array.isArray(tickerData.contextual) ? tickerData.contextual : []);
const stopwordsSet = new Set(Array.isArray(tickerData.stopwords) ? tickerData.stopwords : []);

let lastSyncedDate = tickerData.updatedAt || '';

const MAX_CACHED_URL_TITLES = 1000;
const TRACKING_QUERY_PATTERNS = [
  /^utm_\w+/i,
  /^mc_[a-z]+$/i,
  /^ref(_src|_url)?$/i,
  'fbclid',
  'gclid',
  'igshid',
  'r',
  'showWelcomeOnShare',
  's',
  't',
  'si',
  'feature'
];

const urlTitleMemoryCache = new LRUCache({ max: MAX_CACHED_URL_TITLES });
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

// CJK characters & fullwidth punctuation treated as word/URL boundaries for linkify-it scanning
const CJK_BOUNDARY_RE = /[\u2018-\u201d\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/g;

// Explicit $TICKER cashtags (1-6 letters + optional .A/.B share class) and standalone 2-5 letter words
const CASHTAG_AND_WORD_RE =
  /((?<![A-Za-z0-9_])\$[A-Za-z]{1,6}(?:\.[A-Za-z](?![A-Za-z0-9_]))?(?![A-Za-z0-9_]))|((?<![A-Za-z0-9_$@#-])[A-Za-z]{2,5}(?:\.[ABab](?![A-Za-z0-9_-]))?(?![A-Za-z0-9_-]))/g;

function isValidLinkifyMatch(m) {
  if (!m.schema && !/^www\./i.test(m.raw) && !m.raw.includes('/')) {
    if (!/\.[a-z0-9-]+$/.test(m.raw)) return false;
  }
  return true;
}

function splitUrlToken(urlOrHandle) {
  const raw = String(urlOrHandle || '');
  if (!raw) return { cleanUrl: '', trailingPunct: '', href: '' };
  const scanStr = raw.replace(CJK_BOUNDARY_RE, ' ');
  const matches = linkify.match(scanStr);
  if (matches && matches.length > 0 && matches[0].index === 0) {
    const m = matches[0];
    if (m.schema !== '@' && m.schema !== '#' && m.schema !== 'mailto:' && isValidLinkifyMatch(m)) {
      const cleanUrl = raw.slice(0, m.lastIndex);
      const trailingPunct = raw.slice(m.lastIndex);
      const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
      return { cleanUrl, trailingPunct, href };
    }
  }
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

function tokenizeText(str) {
  if (!str) return [];
  const tokens = [];
  const scanStr = str.replace(CJK_BOUNDARY_RE, ' ');
  const linkMatches = (linkify.match(scanStr) || []).filter(isValidLinkifyMatch);

  const scanPlainGap = (gapStart, gapEnd) => {
    if (gapEnd <= gapStart) return;
    const sub = str.slice(gapStart, gapEnd);
    const re = new RegExp(CASHTAG_AND_WORD_RE.source, 'g');
    let m;
    while ((m = re.exec(sub)) !== null) {
      const raw = m[0];
      const index = gapStart + m.index;
      const lastIndex = index + raw.length;
      if (m[1]) {
        tokens.push({ type: 'cashtag', raw, index, lastIndex });
      } else if (m[2]) {
        tokens.push({ type: 'word', raw, index, lastIndex });
      }
    }
  };

  let cursor = 0;
  for (const m of linkMatches) {
    if (m.index < cursor) continue;
    if (m.index > cursor) {
      scanPlainGap(cursor, m.index);
    }
    const raw = str.slice(m.index, m.lastIndex);
    if (m.schema === '@' || m.schema === '#' || m.schema === 'mailto:') {
      tokens.push({ type: 'passthrough', raw, index: m.index, lastIndex: m.lastIndex });
    } else if (isWebLinkToken(raw)) {
      const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      tokens.push({
        type: 'url',
        raw,
        cleanUrl: raw,
        href,
        index: m.index,
        lastIndex: m.lastIndex
      });
    } else {
      tokens.push({ type: 'passthrough', raw, index: m.index, lastIndex: m.lastIndex });
    }
    cursor = m.lastIndex;
  }

  if (cursor < str.length) {
    scanPlainGap(cursor, str.length);
  }

  return tokens;
}

function normalizeUrlForTitleKey(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const { cleanUrl, href } = splitUrlToken(rawUrl.trim());
  if (!cleanUrl) return '';
  try {
    return normalizeUrl(href, {
      stripWWW: false,
      sortQueryParameters: false,
      removeTrailingSlash: false
    });
  } catch (_) {
    return href;
  }
}

function getCanonicalUrlForTitleKey(rawUrl) {
  const norm = normalizeUrlForTitleKey(rawUrl);
  if (!norm) return '';
  try {
    return normalizeUrl(norm, {
      stripWWW: false,
      stripHash: true,
      removeTrailingSlash: true,
      sortQueryParameters: true,
      removeQueryParameters: TRACKING_QUERY_PATTERNS
    });
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
    saveUrlTitlesCache(Object.fromEntries(urlTitleMemoryCache.entries()));
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
  for (const token of tokenizeText(str)) {
    if (token.type === 'url' && !seen.has(token.cleanUrl)) {
      seen.add(token.cleanUrl);
      urls.push(token.cleanUrl);
    }
  }
  return urls;
}

function replaceUrlsWithTitles(rawText, extraTitlesMap = null) {
  const str = String(rawText || '');
  if (!str) return '';
  let result = '';
  let lastIndex = 0;

  for (const token of tokenizeText(str)) {
    if (token.index > lastIndex) {
      result += str.slice(lastIndex, token.index);
    }
    if (token.type === 'url') {
      const title = getCachedUrlTitle(token.cleanUrl, extraTitlesMap);
      result += title || token.cleanUrl;
    } else {
      result += token.raw;
    }
    lastIndex = token.lastIndex;
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

  let remaining = maxDisplayChars;
  let slicedText = '';
  let lastIndex = 0;
  let overrideTitles = null;
  let stoppedEarly = false;

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

  for (const token of tokenizeText(str)) {
    if (token.index > lastIndex) {
      appendPlainSlice(str.slice(lastIndex, token.index));
      if (stoppedEarly) break;
    }

    if (token.type === 'url') {
      if (remaining <= 0) {
        stoppedEarly = true;
        break;
      }
      const cleanUrl = token.cleanUrl;
      const resolvedTitle = getCachedUrlTitle(cleanUrl, extraTitlesMap);
      const displayLabel = resolvedTitle || cleanUrl;
      const labelChars = Array.from(displayLabel);

      if (labelChars.length <= remaining) {
        slicedText += cleanUrl;
        remaining -= labelChars.length;
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
      lastIndex = token.lastIndex;
      continue;
    }

    appendPlainSlice(token.raw);
    lastIndex = token.lastIndex;
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

  for (const token of tokenizeText(str)) {
    if (token.index > lastIndex) {
      result += escapeHtml(str.slice(lastIndex, token.index));
    }

    const isTicker =
      token.type === 'cashtag' ||
      (token.type === 'word' && isWordTicker(token.raw, str, token.index, hasTradingContext));

    if (token.type === 'url') {
      const { cleanUrl, href } = token;
      const resolvedTitle = getCachedUrlTitle(cleanUrl, extraTitlesMap);
      const displayLabel = resolvedTitle || cleanUrl;
      if (linkifyUrls) {
        result += `<a href="#" class="popup-inline-link" data-url="${escapeHtml(href)}" data-raw-url="${escapeHtml(cleanUrl)}" title="${escapeHtml(href)}">${escapeHtml(displayLabel)}</a>`;
      } else {
        result += `<span class="im-inline-link" data-url="${escapeHtml(href)}" data-raw-url="${escapeHtml(cleanUrl)}" title="${escapeHtml(href)}">${escapeHtml(displayLabel)}</span>`;
      }
    } else if (isTicker) {
      const needLeadingSpace =
        token.index > 0 && !/\s/.test(str[token.index - 1]) && !/\s$/.test(result);
      const needTrailingSpace =
        token.lastIndex < str.length && !/\s/.test(str[token.lastIndex]);
      result += `${needLeadingSpace ? ' ' : ''}<span class="ticker-highlight">${escapeHtml(token.raw)}</span>${needTrailingSpace ? ' ' : ''}`;
    } else {
      result += escapeHtml(token.raw);
    }

    lastIndex = token.lastIndex;
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
