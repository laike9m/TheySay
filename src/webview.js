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

function loadWebviewTarget(wv, targetUrl) {
  return new Promise((resolve) => {
    let done = false;
    const onReady = () => {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      wv.removeEventListener('dom-ready', onReady);
      wv.removeEventListener('did-fail-load', onReady);
    };

    wv.addEventListener('dom-ready', onReady, { once: true });
    wv.addEventListener('did-fail-load', onReady, { once: true });

    setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    }, 6000);

    try {
      wv.loadURL(targetUrl);
    } catch (e) {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    }
  });
}

module.exports = {
  getOrCreateSlotWebview,
  initBackgroundWebviews,
  waitForWebviewReady,
  loadWebviewTarget
};
