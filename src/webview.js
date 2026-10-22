const { THREADS_PARTITION } = require('./constants');
const { isNetworkOnline, canReachHost } = require('./utils');

// Chromium net error codes indicating network disconnection or DNS failure
const OFFLINE_NET_ERROR_CODES = new Set([-106, -105, -21, -109, -118, -102, -101, -137]);

function getOrCreateSlotWebview(slotIndex, bgWebviewsContainer, slots = []) {
  let wv = document.getElementById(`x-bg-webview-${slotIndex}`);
  if (!wv) {
    wv = document.createElement('webview');
    wv.id = `x-bg-webview-${slotIndex}`;
    wv.src = 'about:blank';
    wv.setAttribute('partition', 'persist:x_session');
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });

    if (bgWebviewsContainer) {
      bgWebviewsContainer.appendChild(wv);
    }
    if (slots[slotIndex]) {
      slots[slotIndex].bgWebview = wv;
    }
  }
  return wv;
}

function getOrCreateThreadsSlotWebview(slotIndex, bgWebviewsContainer, slots = []) {
  let wv = document.getElementById(`threads-bg-webview-${slotIndex}`);
  if (!wv) {
    wv = document.createElement('webview');
    wv.id = `threads-bg-webview-${slotIndex}`;
    wv.src = 'about:blank';
    wv.setAttribute('partition', THREADS_PARTITION);
    wv.setAttribute('allowpopups', 'true');
    wv.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');

    wv._isReady = false;
    wv.addEventListener('dom-ready', () => {
      wv._isReady = true;
    }, { once: true });

    if (bgWebviewsContainer) {
      bgWebviewsContainer.appendChild(wv);
    }
    if (slots[slotIndex]) {
      slots[slotIndex].threadsBgWebview = wv;
    }
  }
  return wv;
}

function initBackgroundWebviews(bgWebviewsContainer, slots = [], maxSlots = 16) {
  if (bgWebviewsContainer) {
    bgWebviewsContainer.innerHTML = '';
  }
  for (let i = 0; i < maxSlots; i++) {
    getOrCreateSlotWebview(i, bgWebviewsContainer, slots);
  }
}

function waitForWebviewReady(wv) {
  if (!wv) return Promise.resolve();
  if (wv._isReady) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const onReady = () => {
      if (!done) {
        done = true;
        wv._isReady = true;
        resolve();
      }
    };
    wv.addEventListener('dom-ready', onReady, { once: true });
    setTimeout(onReady, 2000);
  });
}

async function loadWebviewTarget(wv, targetUrl) {
  if (!wv) return { ok: false, offline: !isNetworkOnline() };

  // Avoid invoking wv.loadURL altogether when the system is offline or DNS cannot resolve the host,
  // which prevents Electron's GUEST_VIEW_MANAGER_CALL from throwing ERR_INTERNET_DISCONNECTED / ERR_NAME_NOT_RESOLVED.
  const reachable = await canReachHost(targetUrl);
  if (!reachable) {
    return {
      ok: false,
      offline: true,
      errorCode: -106,
      errorDescription: 'ERR_INTERNET_DISCONNECTED'
    };
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        cleanup();
        resolve(result);
      }
    };
    const onReady = () => finish({ ok: true, offline: false });
    const onFail = (e) => {
      if (e && e.isMainFrame === false) return;
      const code = e && typeof e.errorCode === 'number' ? e.errorCode : 0;
      const desc = (e && e.errorDescription) || '';
      const isOfflineErr = !isNetworkOnline() || OFFLINE_NET_ERROR_CODES.has(code);
      finish({
        ok: !isOfflineErr,
        offline: isOfflineErr,
        errorCode: code,
        errorDescription: desc
      });
    };
    let loadTimer = null;
    const cleanup = () => {
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-fail-load', onFail);
    };

    wv.addEventListener('dom-ready', onReady, { once: true });
    wv.addEventListener('did-fail-load', onFail);

    loadTimer = setTimeout(() => {
      finish({ ok: isNetworkOnline(), offline: !isNetworkOnline() });
    }, 6000);

    try {
      const loadPromise = wv.loadURL(targetUrl);
      if (loadPromise && typeof loadPromise.catch === 'function') {
        loadPromise.catch(() => {});
      }
    } catch (e) {
      finish({ ok: false, offline: !isNetworkOnline() });
    }
  });
}

async function executeWebviewScript(wv, script, timeoutMs = 8000) {
  if (!wv || typeof wv.executeJavaScript !== 'function') return null;
  let timer = null;
  try {
    const execPromise = Promise.resolve(wv.executeJavaScript(script)).catch(() => null);
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true }), timeoutMs);
    });
    const res = await Promise.race([execPromise, timeoutPromise]);
    if (res && res.__timedOut) {
      return null;
    }
    return res;
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  getOrCreateSlotWebview,
  getOrCreateThreadsSlotWebview,
  initBackgroundWebviews,
  waitForWebviewReady,
  loadWebviewTarget,
  executeWebviewScript
};
