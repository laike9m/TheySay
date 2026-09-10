const { shell, ipcRenderer } = require('electron');
const { getTweetId } = require('./tweet');
const { escapeHtml } = require('./utils');

let currentTweet = null;
let loadTimeout = null;

function getTweetIdentifier(tweet) {
  if (!tweet) return '';
  return getTweetId(tweet) || tweet.url || '';
}

function isTweetPopupOpen() {
  const overlay = document.getElementById('tweet-popup-overlay');
  return !!(overlay && overlay.style.display !== 'none');
}

function renderFallbackTweet(tweet, containerEl) {
  if (!containerEl) return;
  const rawText = (tweet.text || '').trim();
  const timeDisplay = tweet.time || (tweet.datetime ? new Date(tweet.datetime).toLocaleString() : '');
  const displayName = tweet.displayName || tweet.userHandle || '';
  const userHandle = tweet.userHandle || '';
  const avatarUrl = tweet.avatarUrl || '';

  const fallbackDiv = document.createElement('div');
  fallbackDiv.className = 'tweet-popup-fallback';

  let quoteInfoHtml = '';
  if (tweet.hasQuote || tweet.quoteUrl) {
    quoteInfoHtml = `
      <div class="tweet-popup-fallback-quote">
        <span class="tweet-tag quote">引用推文</span>
        ${tweet.quoteUrl ? `<a href="#" class="tweet-fallback-quote-link" data-url="${escapeHtml(tweet.quoteUrl)}">查看被引用推文 ↗</a>` : ''}
      </div>
    `;
  }

  fallbackDiv.innerHTML = `
    <div class="tweet-popup-fallback-header">
      ${avatarUrl ? `<img class="tweet-popup-fallback-avatar" src="${escapeHtml(avatarUrl)}" alt="">` : '<div class="tweet-popup-fallback-avatar-placeholder">👤</div>'}
      <div class="tweet-popup-fallback-names">
        <span class="tweet-popup-fallback-name">${escapeHtml(displayName)}</span>
        <span class="tweet-popup-fallback-handle">${escapeHtml(userHandle)}</span>
      </div>
    </div>
    <div class="tweet-popup-fallback-text">${escapeHtml(rawText)}</div>
    ${quoteInfoHtml}
    <div class="tweet-popup-fallback-footer">
      <span class="tweet-popup-fallback-time">${escapeHtml(timeDisplay)}</span>
      ${tweet.url ? `<button class="tweet-popup-fallback-btn" data-url="${escapeHtml(tweet.url)}">在 Twitter / X 上打开 ↗</button>` : ''}
    </div>
  `;

  fallbackDiv.querySelectorAll('[data-url]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      if (url) shell.openExternal(url);
    });
  });

  containerEl.innerHTML = '';
  containerEl.appendChild(fallbackDiv);
}

function openTweetPopup(tweet) {
  if (!tweet) return;

  const tweetId = getTweetId(tweet);
  currentTweet = tweet;

  const overlay = document.getElementById('tweet-popup-overlay');
  const loadingEl = document.getElementById('tweet-popup-loading');
  const containerEl = document.getElementById('tweet-popup-embed-container');

  if (!overlay || !containerEl) return;

  containerEl.innerHTML = '';
  if (loadingEl) loadingEl.style.display = 'flex';
  overlay.style.display = 'flex';

  // Ensure keyboard focus is captured so Esc works immediately
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();

  if (loadTimeout) {
    clearTimeout(loadTimeout);
    loadTimeout = null;
  }

  let hasFinished = false;
  const finish = (fallback = false) => {
    if (hasFinished) return;
    hasFinished = true;
    if (loadTimeout) {
      clearTimeout(loadTimeout);
      loadTimeout = null;
    }
    if (loadingEl) loadingEl.style.display = 'none';
    if (fallback) {
      renderFallbackTweet(tweet, containerEl);
    }
  };

  // Timeout fallback if widget takes too long (e.g. offline / rate-limited)
  loadTimeout = setTimeout(() => {
    finish(true);
  }, 4500);

  const theme = document.documentElement.getAttribute('data-theme') || 'dark';

  const renderWithTwttr = (twttrObj) => {
    if (!twttrObj || !twttrObj.widgets || !twttrObj.widgets.createTweet || !tweetId) {
      finish(true);
      return;
    }
    twttrObj.widgets.createTweet(tweetId, containerEl, {
      theme: theme,
      align: 'center',
      dnt: true
    }).then((el) => {
      if (!el) {
        finish(true);
      } else {
        finish(false);
      }
    }).catch(() => {
      finish(true);
    });
  };

  if (window.twttr && window.twttr.widgets && window.twttr.widgets.createTweet) {
    renderWithTwttr(window.twttr);
  } else if (window.twttr && window.twttr.ready) {
    window.twttr.ready((twttr) => {
      renderWithTwttr(twttr);
    });
  } else {
    finish(true);
  }
}

function closeTweetPopup() {
  const overlay = document.getElementById('tweet-popup-overlay');
  const containerEl = document.getElementById('tweet-popup-embed-container');
  const loadingEl = document.getElementById('tweet-popup-loading');

  if (overlay) overlay.style.display = 'none';
  if (containerEl) containerEl.innerHTML = '';
  if (loadingEl) loadingEl.style.display = 'none';

  if (loadTimeout) {
    clearTimeout(loadTimeout);
    loadTimeout = null;
  }

  currentTweet = null;
}

function initTweetPopup() {
  const overlay = document.getElementById('tweet-popup-overlay');

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // Don't close if user clicked inside fallback card or loading indicator
      const fallback = overlay.querySelector('.tweet-popup-fallback');
      if (fallback && fallback.contains(e.target)) {
        return;
      }
      const loading = document.getElementById('tweet-popup-loading');
      if (loading && loading.contains(e.target)) {
        return;
      }
      closeTweetPopup();
    });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isTweetPopupOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closeTweetPopup();
      }
    });
  }

  // Pressing Escape closes the popup (capture on window and document)
  const handleEscKey = (e) => {
    if (e.key === 'Escape' && isTweetPopupOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closeTweetPopup();
    }
  };

  window.addEventListener('keydown', handleEscKey, true);
  document.addEventListener('keydown', handleEscKey, true);

  // Global escape from main process (intercepts Esc even if focus is inside Twitter iframe)
  if (ipcRenderer) {
    ipcRenderer.on('global-escape', () => {
      if (isTweetPopupOpen()) {
        closeTweetPopup();
      }
    });
  }
}

module.exports = {
  initTweetPopup,
  openTweetPopup,
  closeTweetPopup,
  isTweetPopupOpen
};
