const https = require('https');
const path = require('path');
const { pathToFileURL } = require('url');

// Cache for full tweet payloads (tweetId -> Promise<object|null>)
const fullTweetCache = new Map();
// Cache for syndication tweet-result payloads (url -> Promise<{ status, body, contentType }>)
const syndicationCache = new Map();

function httpsGetText(url, headers = {}, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: Object.assign(
          {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            Accept: 'application/json, text/plain, */*'
          },
          headers
        ),
        timeout: 10000
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          resolve(httpsGetText(nextUrl, headers, redirectsLeft - 1));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 200,
            body,
            contentType: res.headers['content-type'] || 'application/json; charset=utf-8'
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

function convertFacetsToEntities(facets) {
  const entities = {
    hashtags: [],
    symbols: [],
    urls: [],
    user_mentions: []
  };
  if (!Array.isArray(facets)) return entities;

  for (const facet of facets) {
    if (!facet || !Array.isArray(facet.indices) || facet.indices.length < 2) continue;
    const indices = [Number(facet.indices[0]), Number(facet.indices[1])];
    const type = facet.type;

    if (type === 'hashtag' && facet.original) {
      entities.hashtags.push({
        indices,
        text: String(facet.original)
      });
    } else if ((type === 'cashtag' || type === 'symbol') && facet.original) {
      entities.symbols.push({
        indices,
        text: String(facet.original)
      });
    } else if (type === 'mention' && facet.original) {
      entities.user_mentions.push({
        indices,
        screen_name: String(facet.original),
        name: String(facet.name || facet.original),
        id_str: String(facet.id || '')
      });
    } else if (type === 'url' && facet.original) {
      entities.urls.push({
        indices,
        url: String(facet.original),
        expanded_url: String(facet.replacement || facet.original),
        display_url: String(facet.display || facet.replacement || facet.original)
      });
    }
  }

  return entities;
}

function extractFxTwitterImages(tweet) {
  const images = [];
  if (!tweet || !tweet.media) return images;
  const media = tweet.media;
  const addUrl = (u) => {
    if (typeof u === 'string' && u.trim() && !images.includes(u.trim())) {
      images.push(u.trim());
    }
  };
  if (Array.isArray(media.all)) {
    for (const m of media.all) {
      if (!m) continue;
      if (m.type === 'photo' && m.url) {
        addUrl(m.url);
      } else if (m.thumbnail_url || m.url) {
        addUrl(m.thumbnail_url || m.url);
      }
    }
  }
  if (Array.isArray(media.photos)) {
    for (const p of media.photos) {
      if (p && p.url) addUrl(p.url);
    }
  }
  if (Array.isArray(media.videos)) {
    for (const v of media.videos) {
      if (v && (v.thumbnail_url || v.url)) addUrl(v.thumbnail_url || v.url);
    }
  }
  if (media.external && media.external.thumbnail_url) {
    addUrl(media.external.thumbnail_url);
  }
  return images;
}

function extractVxTwitterImages(data) {
  const images = [];
  if (!data) return images;
  const addUrl = (u) => {
    if (typeof u === 'string' && u.trim() && !images.includes(u.trim())) {
      images.push(u.trim());
    }
  };
  if (Array.isArray(data.media_extended)) {
    for (const m of data.media_extended) {
      if (!m) continue;
      if (m.type === 'image' && m.url) {
        addUrl(m.url);
      } else if (m.thumbnail_url || m.url) {
        addUrl(m.thumbnail_url || m.url);
      }
    }
  } else if (Array.isArray(data.mediaURLs)) {
    for (const u of data.mediaURLs) {
      if (typeof u === 'string' && !u.endsWith('.mp4')) addUrl(u);
    }
  }
  return images;
}

function extractSyndicationImages(data) {
  const images = [];
  if (!data) return images;
  const addUrl = (u) => {
    if (typeof u === 'string' && u.trim() && !images.includes(u.trim())) {
      images.push(u.trim());
    }
  };
  if (Array.isArray(data.photos)) {
    for (const p of data.photos) {
      if (p && p.url) addUrl(p.url);
    }
  }
  if (Array.isArray(data.mediaDetails)) {
    for (const m of data.mediaDetails) {
      if (m && m.media_url_https) addUrl(m.media_url_https);
    }
  }
  if (data.video && data.video.poster) {
    addUrl(data.video.poster);
  }
  return images;
}

function fetchFullTweetData(tweetId) {
  const id = String(tweetId || '').trim();
  if (!/^\d+$/.test(id)) return Promise.resolve(null);

  if (typeof window !== 'undefined' && window.__THEYSAY_MOCK_TWEET_DATA) {
    if (typeof window.__THEYSAY_MOCK_TWEET_DATA === 'function') {
      return Promise.resolve(window.__THEYSAY_MOCK_TWEET_DATA(id));
    }
    if (typeof window.__THEYSAY_MOCK_TWEET_DATA === 'object' && window.__THEYSAY_MOCK_TWEET_DATA[id]) {
      return Promise.resolve(window.__THEYSAY_MOCK_TWEET_DATA[id]);
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const rawMock = localStorage.getItem('theysay_mock_tweet_data');
      if (rawMock) {
        const parsedMock = JSON.parse(rawMock);
        if (parsedMock && parsedMock[id]) {
          return Promise.resolve(parsedMock[id]);
        }
      }
    } catch (_) {}
  }

  if (fullTweetCache.has(id)) {
    return fullTweetCache.get(id);
  }

  const promise = (async () => {
    // 1. Primary: FxTwitter API (returns full raw_text + codepoint facets + media)
    try {
      const res = await httpsGetText(`https://api.fxtwitter.com/status/${id}`);
      if (res.status >= 200 && res.status < 300 && res.body) {
        const data = JSON.parse(res.body);
        const tweet = data && data.tweet;
        if (tweet) {
          const rawTextObj = tweet.raw_text;
          const text = (rawTextObj && rawTextObj.text) || tweet.text || '';
          const entities = convertFacetsToEntities(rawTextObj && rawTextObj.facets);
          const images = extractFxTwitterImages(tweet);
          return {
            id,
            text,
            codePointLength: Array.from(text).length,
            entities,
            images
          };
        }
      }
    } catch (_) {}

    // 2. Fallback: VxTwitter API
    try {
      const res = await httpsGetText(`https://api.vxtwitter.com/Twitter/status/${id}`);
      if (res.status >= 200 && res.status < 300 && res.body) {
        const data = JSON.parse(res.body);
        if (data && (data.text || data.media_extended || data.mediaURLs)) {
          const text = String(data.text || '');
          const images = extractVxTwitterImages(data);
          return {
            id,
            text,
            codePointLength: Array.from(text).length,
            entities: null,
            images
          };
        }
      }
    } catch (_) {}

    // 3. Fallback: Twitter Syndication API
    try {
      const res = await httpsGetText(
        `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=a`,
        {
          Origin: 'https://platform.twitter.com',
          Referer: 'https://platform.twitter.com/'
        }
      );
      if (res.status >= 200 && res.status < 300 && res.body) {
        const data = JSON.parse(res.body);
        if (data && typeof data === 'object' && (data.text || data.photos || data.mediaDetails || data.video)) {
          const text = String(data.text || '');
          const images = extractSyndicationImages(data);
          return {
            id,
            text,
            codePointLength: Array.from(text).length,
            entities: null,
            images
          };
        }
      }
    } catch (_) {}

    fullTweetCache.delete(id);
    return null;
  })();

  fullTweetCache.set(id, promise);
  return promise;
}

function prefetchNoteTweetsFromSyndicationJson(body) {
  if (!body) return;
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object') return;
    if (data.note_tweet && data.id_str) {
      fetchFullTweetData(data.id_str);
    }
    if (data.quoted_tweet && data.quoted_tweet.note_tweet && data.quoted_tweet.id_str) {
      fetchFullTweetData(data.quoted_tweet.id_str);
    }
    if (data.parent && data.parent.note_tweet && data.parent.id_str) {
      fetchFullTweetData(data.parent.id_str);
    }
  } catch (_) {}
}

function fetchSyndicationUrl(url) {
  const targetUrl = String(url || '');
  if (!targetUrl) {
    return Promise.resolve({ status: 400, body: '', contentType: 'text/plain' });
  }
  if (targetUrl.includes('/i/jot')) {
    return Promise.resolve({ status: 200, body: '{}', contentType: 'application/json' });
  }
  if (syndicationCache.has(targetUrl)) {
    return syndicationCache.get(targetUrl);
  }

  const headers = {
    Origin: 'https://platform.twitter.com',
    Referer: 'https://platform.twitter.com/'
  };

  const promise = (async () => {
    try {
      const res = await httpsGetText(targetUrl, headers);
      if (res.status >= 200 && res.status < 300 && res.body) {
        if (targetUrl.includes('tweet-result')) {
          prefetchNoteTweetsFromSyndicationJson(res.body);
        }
        return res;
      }
    } catch (_) {}

    // Fallback between syndication.x.com and cdn.syndication.twimg.com
    try {
      const fallbackUrl = targetUrl.includes('syndication.x.com')
        ? targetUrl.replace('syndication.x.com', 'cdn.syndication.twimg.com')
        : targetUrl.replace('cdn.syndication.twimg.com', 'syndication.x.com');
      if (fallbackUrl !== targetUrl) {
        const res = await httpsGetText(fallbackUrl, headers);
        if (res.status >= 200 && res.status < 300 && res.body) {
          if (fallbackUrl.includes('tweet-result')) {
            prefetchNoteTweetsFromSyndicationJson(res.body);
          }
          return res;
        }
      }
    } catch (_) {}

    syndicationCache.delete(targetUrl);
    return { status: 500, body: '', contentType: 'text/plain' };
  })();

  syndicationCache.set(targetUrl, promise);
  return promise;
}

// Self-contained function that runs inside the Twitter embed iframe (both via
// same-origin tweet-embed-frame.html and via main.js frame.executeJavaScript).
function embedFrameEnhancementRuntime(win, doc) {
  win = win || window;
  doc = doc || document;
  if (win.__theysayEmbedEnhanced) return;
  win.__theysayEmbedEnhanced = true;

  // 1. Intercept XMLHttpRequest for syndication endpoints when running inside local frame
  if (win.parent && win.parent !== win && typeof win.parent.__theysayProxyXhr === 'function') {
    const NativeXHR = win.XMLHttpRequest;
    if (NativeXHR && !NativeXHR.__theysayPatched) {
      const origOpen = NativeXHR.prototype.open;
      const origSend = NativeXHR.prototype.send;
      const origSetRequestHeader = NativeXHR.prototype.setRequestHeader;

      NativeXHR.prototype.open = function (method, url) {
        this.__theysayMethod = method;
        this.__theysayUrl = String(url || '');
        if (
          this.__theysayUrl.includes('syndication.x.com') ||
          this.__theysayUrl.includes('syndication.twimg.com') ||
          this.__theysayUrl.includes('syndication.twitter.com')
        ) {
          this.__theysayIntercept = true;
          return;
        }
        return origOpen.apply(this, arguments);
      };

      NativeXHR.prototype.setRequestHeader = function () {
        if (this.__theysayIntercept) return;
        return origSetRequestHeader.apply(this, arguments);
      };

      NativeXHR.prototype.send = function () {
        if (!this.__theysayIntercept) {
          return origSend.apply(this, arguments);
        }
        const self = this;
        win.parent
          .__theysayProxyXhr(this.__theysayUrl)
          .then((res) => {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: res.status || 200, configurable: true });
            Object.defineProperty(self, 'responseText', { value: res.body || '', configurable: true });
            Object.defineProperty(self, 'response', { value: res.body || '', configurable: true });
            self.getAllResponseHeaders = function () {
              return 'content-type: ' + (res.contentType || 'application/json') + '\r\n';
            };
            if (typeof self.onreadystatechange === 'function') {
              self.onreadystatechange();
            }
            if (typeof self.onload === 'function') {
              self.onload();
            }
          })
          .catch((err) => {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: 0, configurable: true });
            if (typeof self.onreadystatechange === 'function') {
              self.onreadystatechange();
            }
            if (typeof self.onerror === 'function') {
              self.onerror(err);
            }
          });
      };

      NativeXHR.__theysayPatched = true;
    }
  }

  // 2. Block programmatic window.open and anchor.click() triggered by card containers
  try {
    win.open = function () {
      return null;
    };
  } catch (_) {}

  try {
    if (win.HTMLAnchorElement && win.HTMLAnchorElement.prototype) {
      win.HTMLAnchorElement.prototype.click = function () {};
    }
  } catch (_) {}

  // 3. Inject CSS so non-allowed areas show default/text cursor instead of pointer
  //    and lock the article card background so it never darkens on hover/press/selection.
  const isDarkTheme = /[?&]theme=dark\b/i.test(String(win.location.search || ''));
  const injectStyle = () => {
    const root = doc.head || doc.documentElement;
    if (!root || doc.getElementById('theysay-embed-style')) return;
    const style = doc.createElement('style');
    style.id = 'theysay-embed-style';
    style.textContent = `
      article[role="article"] {
        background-color: ${isDarkTheme ? '#000000' : '#ffffff'} !important;
        transition: none !important;
      }
      article[role="article"],
      article[role="article"] * {
        cursor: default !important;
      }
      [data-testid="tweetText"],
      [data-testid="tweetText"] * {
        cursor: text !important;
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      a[data-testid="tweet-text-show-more-link"],
      a[data-testid="tweet-text-show-more-link"] *,
      a[data-theysay-allow-open],
      a[data-theysay-allow-open] *,
      video,
      video * {
        cursor: pointer !important;
      }
      a[data-testid="tweet-text-show-more-link"]:hover {
        text-decoration: underline !important;
      }
    `;
    root.appendChild(style);
  };

  if (doc.head || doc.documentElement) {
    injectStyle();
  } else {
    doc.addEventListener('DOMContentLoaded', injectStyle, { once: true });
  }

  // 4. React Fiber helpers
  const getReactFiber = (el) => {
    if (!el || typeof el !== 'object') return null;
    for (const key of Object.keys(el)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        return el[key];
      }
    }
    return null;
  };

  const getFiberSourceFiles = (el) => {
    const files = [];
    let fiber = getReactFiber(el);
    let depth = 0;
    while (fiber && depth < 35) {
      if (fiber._debugSource && fiber._debugSource.fileName) {
        files.push(String(fiber._debugSource.fileName));
      }
      fiber = fiber.return;
      depth++;
    }
    return files;
  };

  const findRootTweetComponentInstance = () => {
    const candidates = [
      doc.querySelector('[data-testid="tweetText"]'),
      doc.querySelector('article[role="article"]'),
      doc.getElementById('app') && doc.getElementById('app').firstElementChild
    ].filter(Boolean);

    for (const el of candidates) {
      let fiber = getReactFiber(el);
      let depth = 0;
      while (fiber && depth < 60) {
        const inst = fiber.stateNode;
        if (
          inst &&
          typeof inst.setState === 'function' &&
          inst.state &&
          inst.state.tweet &&
          typeof inst.state.tweet === 'object'
        ) {
          return inst;
        }
        fiber = fiber.return;
        depth++;
      }
    }
    return null;
  };

  const neutralizeCardContainerClick = () => {
    const article = doc.querySelector('article[role="article"]');
    if (!article) return;
    let fiber = getReactFiber(article);
    let depth = 0;
    while (fiber && depth < 25) {
      const inst = fiber.stateNode;
      if (inst && typeof inst === 'object') {
        if (typeof inst.handleListItemViewClick === 'function') {
          inst.handleListItemViewClick = function () {};
        }
        // Neutralize Twitter's Interactable (module 86953) hover/press/focus state on the card
        // so selecting text or hovering never applies activeFaintGray / hoverBlack darkening.
        if (inst.state && ('isPressed' in inst.state || 'isHovered' in inst.state)) {
          inst._handlePressDown = function () {};
          inst._handleHoverIn = function () {};
          inst._handleFocus = function () {};
          inst._handleMouseDown = function () {};
          inst._handleMouseEnter = function () {};
          if (
            inst.state.isPressed ||
            inst.state.isHovered ||
            inst.state.isFocused ||
            inst.state.isFocusedWithin
          ) {
            try {
              inst.setState({
                isFocusedWithin: false,
                isFocused: false,
                isHovered: false,
                isPressed: false
              });
            } catch (_) {}
          }
        }
      }
      fiber = fiber.return;
      depth++;
    }
  };

  // 5. Identify the 3 allowed interactive links:
  //    (a) "Show more" link ([data-testid="tweet-text-show-more-link"])
  //    (b) Top-right X logo (TwitterLogo/index.js)
  //    (c) Bottom "Read X replies" primary button (PrimaryActionButton/index.js)
  const isShowMoreAnchor = (a) => {
    if (!a) return false;
    if (a.getAttribute('data-testid') === 'tweet-text-show-more-link') return true;
    if (a.closest('[data-testid="tweetText"]')) {
      const text = (a.textContent || '').trim();
      if (/^(Show\s+more|显示更多|查看更多)$/i.test(text)) return true;
    }
    return false;
  };

  const isTopRightXLogoAnchor = (a) => {
    if (!a) return false;
    if (a.getAttribute('data-theysay-allow-open') === 'x-logo') return true;
    const sources = getFiberSourceFiles(a);
    if (sources.some((s) => s.includes('TwitterLogo/'))) return true;

    const href = a.getAttribute('href') || '';
    if (href.includes('twcon%5Es1_c4') || href.includes('twcon%5Es2_c4')) return true;

    const pathEl = a.querySelector('svg path');
    if (pathEl) {
      const d = pathEl.getAttribute('d') || '';
      if (d.startsWith('M18.244 2.25h3.308')) return true;
    }
    return false;
  };

  const isReadRepliesButtonAnchor = (a) => {
    if (!a) return false;
    if (a.getAttribute('data-theysay-allow-open') === 'replies-btn') return true;
    if (a.closest('[data-testid="tweetText"]')) return false;
    if (a.querySelector('svg')) return false;

    const sources = getFiberSourceFiles(a);
    if (sources.some((s) => s.includes('PrimaryActionButton/'))) return true;

    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;

    if (
      /^(Read\s+[\d,.]+[KMB]?\s+repl(y|ies)|Read\s+the\s+full\s+conversation|View\s+replies|View\s+conversation|Read\s+more\s+on\s+X|View\s+on\s+X|Continue\s+watching\s+on\s+X|Watch\s+on\s+X|See\s+the\s+latest|阅读.*回复|查看.*回复|阅读完整对话|在\s*X\s*上查看)/i.test(
        text
      )
    ) {
      return true;
    }

    const article = a.closest('article[role="article"]');
    if (article && article.lastElementChild && article.lastElementChild.contains(a)) {
      return true;
    }

    return false;
  };

  const extractTweetIdFromUrl = (url) => {
    const m = String(url || '').match(/status\/(\d+)/);
    return m ? m[1] : null;
  };

  const getMainTweetId = () => {
    const m = String(win.location.search || '').match(/[?&]id=(\d+)/);
    return m ? m[1] : null;
  };

  const requestFullTweetFromParent = (tweetId) => {
    if (!tweetId) return Promise.resolve(null);
    if (win.parent && win.parent !== win && typeof win.parent.__theysayFetchFullTweet === 'function') {
      return win.parent.__theysayFetchFullTweet(tweetId);
    }
    return new Promise((resolve) => {
      const reqId = 'ts_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const onMessage = (e) => {
        const d = e && e.data;
        if (d && d.type === 'theysay-full-tweet-result' && d.reqId === reqId) {
          win.removeEventListener('message', onMessage);
          resolve(d.payload || null);
        }
      };
      win.addEventListener('message', onMessage);
      setTimeout(() => {
        win.removeEventListener('message', onMessage);
        resolve(null);
      }, 8000);
      if (win.parent && win.parent !== win) {
        win.parent.postMessage(
          { type: 'theysay-fetch-full-tweet', tweetId: String(tweetId), reqId },
          '*'
        );
      } else {
        resolve(null);
      }
    });
  };

  const notifyEmbedResize = () => {
    const notify = () => {
      const appEl = doc.getElementById('app');
      const articleEl = doc.querySelector('article[role="article"]');
      const targetEl = (appEl && appEl.firstElementChild) || articleEl || doc.body;
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      const height = Math.ceil(Math.max(rect.height, targetEl.scrollHeight || 0));
      const width = Math.ceil(rect.width || 550);
      if (height <= 0) return;

      const embedIdMatch = String(win.location.search || '').match(/[?&]embedId=([^&]+)/);
      const embedId = embedIdMatch ? decodeURIComponent(embedIdMatch[1]) : undefined;
      const tweetId = getMainTweetId();

      if (win.parent && win.parent !== win) {
        if (embedId) {
          win.parent.postMessage(
            {
              'twttr.embed': {
                jsonrpc: '2.0',
                method: 'twttr.private.resize',
                id: embedId,
                params: [{ width, height, data: { tweet_id: tweetId } }]
              }
            },
            '*'
          );
        }
        win.parent.postMessage(
          {
            type: 'theysay-embed-resize',
            tweetId,
            embedId,
            height,
            width
          },
          '*'
        );
      }
    };

    notify();
    requestAnimationFrame(notify);
    setTimeout(notify, 60);
    setTimeout(notify, 180);
  };

  const applyExpandedTweetToRecord = (record, fullData) => {
    const startIdx =
      Array.isArray(record.display_text_range) && typeof record.display_text_range[0] === 'number'
        ? record.display_text_range[0]
        : 0;
    const endIdx = Math.max(
      fullData.codePointLength || 0,
      String(fullData.text || '').length
    );
    const prevEntities = record.entities || {};
    const nextEntities = fullData.entities
      ? Object.assign({}, prevEntities, {
          hashtags: fullData.entities.hashtags || [],
          symbols: fullData.entities.symbols || [],
          urls: fullData.entities.urls || [],
          user_mentions: fullData.entities.user_mentions || [],
          media: prevEntities.media || []
        })
      : prevEntities;

    return Object.assign({}, record, {
      text: fullData.text,
      display_text_range: [startIdx, endIdx],
      entities: nextEntities,
      note_tweet: undefined
    });
  };

  const handleShowMoreClick = async (showMoreAnchor) => {
    if (!showMoreAnchor || showMoreAnchor.dataset.theysayExpanding === '1') return;
    showMoreAnchor.dataset.theysayExpanding = '1';

    const originalLabel = showMoreAnchor.textContent;
    showMoreAnchor.textContent = ' ...';

    const targetTweetId =
      extractTweetIdFromUrl(showMoreAnchor.getAttribute('href')) || getMainTweetId();
    const fullData = await requestFullTweetFromParent(targetTweetId);

    if (!fullData || !fullData.text) {
      showMoreAnchor.textContent = originalLabel;
      delete showMoreAnchor.dataset.theysayExpanding;
      return;
    }

    const inst = findRootTweetComponentInstance();
    if (inst && inst.state && inst.state.tweet) {
      const currentTweet = inst.state.tweet;
      let updatedTweet = null;

      if (String(currentTweet.id_str) === String(targetTweetId)) {
        updatedTweet = applyExpandedTweetToRecord(currentTweet, fullData);
      } else if (
        currentTweet.quoted_tweet &&
        String(currentTweet.quoted_tweet.id_str) === String(targetTweetId)
      ) {
        updatedTweet = Object.assign({}, currentTweet, {
          quoted_tweet: applyExpandedTweetToRecord(currentTweet.quoted_tweet, fullData)
        });
      } else if (
        currentTweet.parent &&
        String(currentTweet.parent.id_str) === String(targetTweetId)
      ) {
        updatedTweet = Object.assign({}, currentTweet, {
          parent: applyExpandedTweetToRecord(currentTweet.parent, fullData)
        });
      } else {
        updatedTweet = applyExpandedTweetToRecord(currentTweet, fullData);
      }

      inst.setState({ tweet: updatedTweet }, () => {
        notifyEmbedResize();
      });
      notifyEmbedResize();
      return;
    }

    // Fallback DOM expansion if React component instance was not found
    const tweetTextEl = showMoreAnchor.closest('[data-testid="tweetText"]');
    if (tweetTextEl) {
      tweetTextEl.innerHTML = '';
      const span = doc.createElement('span');
      span.style.whiteSpace = 'pre-wrap';
      span.textContent = fullData.text;
      tweetTextEl.appendChild(span);
      notifyEmbedResize();
    }
  };

  const tagInteractiveElements = () => {
    injectStyle();
    neutralizeCardContainerClick();

    const anchors = doc.querySelectorAll('a');
    anchors.forEach((a) => {
      if (isShowMoreAnchor(a)) {
        const tid = extractTweetIdFromUrl(a.getAttribute('href')) || getMainTweetId();
        if (tid && !a.dataset.theysayPrefetched) {
          a.dataset.theysayPrefetched = '1';
          requestFullTweetFromParent(tid);
        }
        return;
      }
      if (isTopRightXLogoAnchor(a)) {
        a.setAttribute('data-theysay-allow-open', 'x-logo');
        return;
      }
      if (isReadRepliesButtonAnchor(a)) {
        a.setAttribute('data-theysay-allow-open', 'replies-btn');
      }
    });
  };

  const observer = new MutationObserver(() => {
    tagInteractiveElements();
  });
  observer.observe(doc.documentElement || doc, {
    childList: true,
    subtree: true
  });

  if (doc.readyState !== 'loading') {
    tagInteractiveElements();
  } else {
    doc.addEventListener('DOMContentLoaded', tagInteractiveElements, { once: true });
  }

  const openCleanExternalUrl = (rawHref) => {
    if (!rawHref) return;
    let cleanUrl = String(rawHref);
    try {
      const u = new URL(cleanUrl, 'https://x.com');
      u.searchParams.delete('ref_src');
      u.searchParams.delete('ref_url');
      u.searchParams.delete('s');
      cleanUrl = u.toString();
    } catch (_) {}

    if (win.parent && win.parent !== win) {
      win.parent.postMessage({ type: 'theysay-open-external', url: cleanUrl }, '*');
    }
  };

  const handlePointerClick = (e) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    // 1. Check "Show more" link
    const showMoreAnchor = target.closest('a[data-testid="tweet-text-show-more-link"]');
    if (showMoreAnchor || isShowMoreAnchor(target.closest('a'))) {
      const anchor = showMoreAnchor || target.closest('a');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === 'click') {
        handleShowMoreClick(anchor);
      }
      return;
    }

    // 2. Check Top-right X logo or Bottom "Read X replies" button
    const anchor = target.closest('a');
    if (anchor && (isTopRightXLogoAnchor(anchor) || isReadRepliesButtonAnchor(anchor))) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === 'click' || (e.type === 'auxclick' && e.button === 1)) {
        const href =
          anchor.getAttribute('href') ||
          (getMainTweetId() ? `https://x.com/i/web/status/${getMainTweetId()}` : '');
        openCleanExternalUrl(href);
      }
      return;
    }

    // 3. Allow native video playback controls inside embedded video players
    if (
      target.closest('video') ||
      target.closest('[data-testid="playButton"]') ||
      (target.closest('[role="button"]') && !anchor)
    ) {
      e.stopPropagation();
      return;
    }

    // 4. Block all other clicks (text body, hashtags/cashtags/mentions/links in text,
    //    card background, author header, timestamp, quoted tweet, action icons) from
    //    opening external browser windows.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const handlePressStart = (e) => {
    // Tell Twitter's Interactable (module 86953) that press was already handled
    // so dragging/selecting text never sets isPressed=true or darkens the card.
    e._interactivePressHandled = true;
    neutralizeCardContainerClick();
  };

  win.addEventListener('mousedown', handlePressStart, true);
  win.addEventListener('touchstart', handlePressStart, true);
  win.addEventListener('click', handlePointerClick, true);
  win.addEventListener('auxclick', handlePointerClick, true);
}

const TWEET_EMBED_ENHANCEMENT_SCRIPT = `(${embedFrameEnhancementRuntime.toString()})(window, document);`;

function getLocalEmbedFrameFileUrl() {
  const htmlPath = path.join(__dirname, 'tweet-embed-frame.html');
  return pathToFileURL(htmlPath).toString();
}

function installRendererEmbedHooks({ onOpenExternal, onEmbedResize } = {}) {
  if (typeof window === 'undefined' || window.__theysayRendererEmbedHooksInstalled) return;
  window.__theysayRendererEmbedHooksInstalled = true;

  // Expose synchronous hooks for same-origin tweet-embed-frame.html iframes
  window.__theysayInitEmbedFrame = function (frameWin, frameDoc) {
    embedFrameEnhancementRuntime(frameWin, frameDoc);
  };

  window.__theysayProxyXhr = function (url) {
    return fetchSyndicationUrl(url);
  };

  window.__theysayFetchFullTweet = function (tweetId) {
    return fetchFullTweetData(tweetId);
  };

  // Intercept Twitter widgets.js setting iframe.src = "https://platform.twitter.com/embed/Tweet.html?..."
  // and redirect to our local same-origin tweet-embed-frame.html so click interception and
  // in-place "Show more" expansion work immediately without cross-origin restrictions.
  const localFrameBaseUrl = getLocalEmbedFrameFileUrl();
  const rewriteEmbedUrl = (val) => {
    const str = String(val || '');
    if (
      str.startsWith('https://platform.twitter.com/embed/Tweet.html') ||
      str.startsWith('http://platform.twitter.com/embed/Tweet.html')
    ) {
      const qIndex = str.indexOf('?');
      const query = qIndex >= 0 ? str.slice(qIndex) : '';
      return localFrameBaseUrl + query;
    }
    return val;
  };

  try {
    const proto = HTMLIFrameElement && HTMLIFrameElement.prototype;
    if (proto) {
      const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
      if (srcDesc && srcDesc.set && srcDesc.get) {
        Object.defineProperty(proto, 'src', {
          configurable: true,
          enumerable: srcDesc.enumerable,
          get() {
            return srcDesc.get.call(this);
          },
          set(val) {
            return srcDesc.set.call(this, rewriteEmbedUrl(val));
          }
        });
      }

      const origSetAttribute = proto.setAttribute;
      proto.setAttribute = function (name, val) {
        if (String(name).toLowerCase() === 'src') {
          return origSetAttribute.call(this, name, rewriteEmbedUrl(val));
        }
        return origSetAttribute.apply(this, arguments);
      };
    }
  } catch (_) {}

  // Listen for postMessage events from embed frames (works for both local and remote frames)
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'theysay-open-external' && d.url) {
      if (typeof onOpenExternal === 'function') {
        onOpenExternal(d.url);
      }
    } else if (d.type === 'theysay-fetch-full-tweet' && d.tweetId && d.reqId) {
      fetchFullTweetData(d.tweetId).then((payload) => {
        try {
          if (e.source && typeof e.source.postMessage === 'function') {
            e.source.postMessage(
              {
                type: 'theysay-full-tweet-result',
                reqId: d.reqId,
                payload
              },
              '*'
            );
          }
        } catch (_) {}
      });
    } else if (d.type === 'theysay-embed-resize' && d.height) {
      if (typeof onEmbedResize === 'function') {
        onEmbedResize(d);
      }
    }
  });
}

module.exports = {
  TWEET_EMBED_ENHANCEMENT_SCRIPT,
  fetchFullTweetData,
  fetchSyndicationUrl,
  installRendererEmbedHooks
};
