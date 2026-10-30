const { ipcRenderer } = require('electron');
const {
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_THREADS_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_FILTER_KEYWORDS,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_APP_BADGE_ENABLED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  DEFAULT_HEADER_BG_COLOR,
  DEFAULT_DARK_HEADER_BG_COLOR,
  DEFAULT_CHAT_BG_COLOR,
  DEFAULT_DARK_CHAT_BG_COLOR,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_DARK_BUBBLE_BG_COLOR,
  DEFAULT_AUTO_CHECK_UPDATES
} = require('../core/constants');
const {
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getThreadsIntervalMinutes,
  saveThreadsIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getShowMemberOnlyPosts,
  saveShowMemberOnlyPosts,
  getFilterKeywords,
  saveFilterKeywords,
  getDiscordSoundEnabled,
  saveDiscordSoundEnabled,
  getAppBadgeEnabled,
  saveAppBadgeEnabled,
  getAutoCheckUpdates,
  saveAutoCheckUpdates,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor,
  getHeaderBgColor,
  saveHeaderBgColor,
  getChatBgColor,
  saveChatBgColor,
  getBubbleBgColor,
  saveBubbleBgColor,
  getStoredTheme,
  getLanguage,
  saveLanguage,
  clearStoredLanguage
} = require('../core/storage');
const {
  applyTickerColors,
  syncOnlineTickers,
  getTickerStats
} = require('../core/ticker');
const {
  applyHeaderColor,
  resolveHeaderPalette,
  applyChatBgColor,
  resolveChatBgPalette,
  applyBubbleColor,
  resolveBubblePalette,
  normalizeHexColor
} = require('./theme');
const { showToast } = require('../core/utils');
const {
  t,
  detectSystemLanguage,
  setActiveLanguageOverride
} = require('../core/i18n');

const { colord } = require('colord');

const INTERVAL_CONTROLS = [
  {
    key: 'twitterIntervalMinutes',
    selectId: 'setting-twitter-interval',
    wrapId: 'setting-twitter-custom-wrap',
    inputId: 'setting-twitter-custom',
    get: getTwitterIntervalMinutes,
    save: saveTwitterIntervalMinutes,
    defaultVal: DEFAULT_TWITTER_INTERVAL_MINUTES,
    normalize: (v) => Math.max(1, Math.round(v)),
    errKey: 'settings.toastInvalidTwitterInterval'
  },
  {
    key: 'threadsIntervalMinutes',
    selectId: 'setting-threads-interval',
    wrapId: 'setting-threads-custom-wrap',
    inputId: 'setting-threads-custom',
    get: getThreadsIntervalMinutes,
    save: saveThreadsIntervalMinutes,
    defaultVal: DEFAULT_THREADS_INTERVAL_MINUTES,
    normalize: (v) => Math.max(1, Math.round(v)),
    errKey: 'settings.toastInvalidThreadsInterval'
  },
  {
    key: 'discordIntervalMinutes',
    selectId: 'setting-discord-interval',
    wrapId: 'setting-discord-custom-wrap',
    inputId: 'setting-discord-custom',
    get: getDiscordIntervalMinutes,
    save: saveDiscordIntervalMinutes,
    defaultVal: DEFAULT_DISCORD_INTERVAL_MINUTES,
    normalize: (v) => Math.max(0.5, Math.round(v * 10) / 10),
    errKey: 'settings.toastInvalidDiscordInterval'
  }
];

const BOOL_SELECT_CONTROLS = [
  {
    key: 'showMemberOnlyPosts',
    id: 'setting-show-member-only',
    get: getShowMemberOnlyPosts,
    save: saveShowMemberOnlyPosts,
    defaultVal: DEFAULT_SHOW_MEMBER_ONLY
  },
  {
    key: 'discordSoundEnabled',
    id: 'setting-discord-sound',
    get: getDiscordSoundEnabled,
    save: saveDiscordSoundEnabled,
    defaultVal: DEFAULT_DISCORD_SOUND_ENABLED
  },
  {
    key: 'appBadgeEnabled',
    id: 'setting-app-badge',
    get: getAppBadgeEnabled,
    save: saveAppBadgeEnabled,
    defaultVal: DEFAULT_APP_BADGE_ENABLED
  },
  {
    key: 'autoCheckUpdates',
    id: 'setting-auto-update',
    get: getAutoCheckUpdates,
    save: saveAutoCheckUpdates,
    defaultVal: DEFAULT_AUTO_CHECK_UPDATES
  }
];

let isInitialized = false;
let onLanguageChangeCallback = null;
let onSaveCallback = null;
let autoUpdateIntervalId = null;
let currentUpdateState = {
  state: 'idle',
  currentVersion: '1.0.0',
  latestVersion: null,
  updateAvailable: false,
  progress: 0
};

function notifySaved() {
  if (typeof onSaveCallback === 'function') {
    onSaveCallback({
      language: getLanguage(),
      twitterMinutes: getTwitterIntervalMinutes(),
      threadsMinutes: getThreadsIntervalMinutes(),
      discordMinutes: getDiscordIntervalMinutes(),
      showMemberOnly: getShowMemberOnlyPosts(),
      filterKeywords: getFilterKeywords(),
      discordSoundEnabled: getDiscordSoundEnabled(),
      appBadgeEnabled: getAppBadgeEnabled(),
      autoCheckUpdates: getAutoCheckUpdates(),
      headerBgColor: getHeaderBgColor(),
      chatBgColor: getChatBgColor(),
      bubbleBgColor: getBubbleBgColor(),
      tickerFgColor: getTickerFgColor(),
      tickerBgColor: getTickerBgColor()
    });
  }
}

function syncFilterKeywordsControl(keywords = getFilterKeywords()) {
  if (typeof window !== 'undefined' && window.__THEYSAY_FILTER_KEYWORDS_BRIDGE) {
    window.__THEYSAY_FILTER_KEYWORDS_BRIDGE.setKeywords(keywords);
  }
}

function commitPendingFilterKeywordsInput({ triggerSave = true } = {}) {
  if (typeof window !== 'undefined' && window.__THEYSAY_FILTER_KEYWORDS_BRIDGE) {
    return window.__THEYSAY_FILTER_KEYWORDS_BRIDGE.commitPending({ notify: triggerSave });
  }
  return getFilterKeywords();
}

function getOverlay() {
  return document.getElementById('settings-modal-overlay');
}

function isSettingsModalOpen() {
  const overlay = getOverlay();
  return !!(overlay && !overlay.classList.contains('is-closed'));
}

function syncCustomVisibility(selectEl, customWrapEl) {
  customWrapEl.style.display = selectEl.value === 'custom' ? 'flex' : 'none';
}

function populateSelectAndInput(selectEl, customWrapEl, customInputEl, currentVal) {
  const matchingOption = Array.from(selectEl.options).find(
    opt => opt.value !== 'custom' && parseFloat(opt.value) === currentVal
  );
  selectEl.value = matchingOption ? matchingOption.value : 'custom';
  customWrapEl.style.display = matchingOption ? 'none' : 'flex';
  customInputEl.value = currentVal;
}

function updateHeaderPreviewUI(bgColor, { liveApply = false } = {}) {
  const palette = resolveHeaderPalette(bgColor);

  const barEl = document.getElementById('setting-header-preview-bar');
  const nameEl = document.getElementById('setting-header-preview-name');
  const handleEl = document.getElementById('setting-header-preview-handle');
  const dragEl = document.getElementById('setting-header-preview-drag');
  const iconEl = document.getElementById('setting-header-preview-icon');

  if (barEl) {
    barEl.style.backgroundColor = palette.bg;
    barEl.style.borderBottomColor = 'transparent';
  }
  if (nameEl) nameEl.style.color = palette.text;
  if (handleEl) handleEl.style.color = palette.subtext;
  if (dragEl) dragEl.style.color = palette.subtext;
  if (iconEl) iconEl.style.color = palette.subtext;

  document.querySelectorAll('#setting-header-presets .header-preset-chip').forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === palette.bg);
  });

  if (liveApply) {
    applyHeaderColor(palette.bg);
  }
}

function setHeaderColorInputs(bgColor, { liveApply = false } = {}) {
  const fallback = getStoredTheme() === 'light' ? DEFAULT_HEADER_BG_COLOR : DEFAULT_DARK_HEADER_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const bgInput = document.getElementById('setting-header-bg-color');
  const bgHex = document.getElementById('setting-header-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateHeaderPreviewUI(bg, { liveApply });
}

function updateChatBgPreviewUI(bgColor, { liveApply = false } = {}) {
  const palette = resolveChatBgPalette(bgColor);

  const cardEl = document.getElementById('setting-header-preview');
  const bodyEl = document.getElementById('setting-ticker-preview');
  const barEl = document.getElementById('setting-header-preview-bar');
  const nameEl = document.getElementById('setting-header-preview-name');
  const handleEl = document.getElementById('setting-header-preview-handle');
  const iconEl = document.getElementById('setting-header-preview-icon');

  if (cardEl) cardEl.style.backgroundColor = palette.bg;
  if (bodyEl) bodyEl.style.backgroundColor = palette.bg;

  const curHeader = getHeaderBgColor();
  if (
    curHeader === palette.bg ||
    curHeader === DEFAULT_HEADER_BG_COLOR ||
    curHeader === DEFAULT_DARK_HEADER_BG_COLOR
  ) {
    if (barEl) barEl.style.backgroundColor = palette.bg;
    if (nameEl) nameEl.style.color = palette.text;
    if (handleEl) handleEl.style.color = palette.subtext;
    if (iconEl) iconEl.style.color = palette.subtext;
  }

  document.querySelectorAll('#setting-chat-bg-presets .chat-bg-preset-chip').forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === palette.bg);
  });

  if (liveApply) {
    applyChatBgColor(palette.bg);
  }
}

function setChatBgColorInputs(bgColor, { liveApply = false } = {}) {
  const fallback = getStoredTheme() === 'light' ? DEFAULT_CHAT_BG_COLOR : DEFAULT_DARK_CHAT_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const bgInput = document.getElementById('setting-chat-bg-color');
  const bgHex = document.getElementById('setting-chat-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateChatBgPreviewUI(bg, { liveApply });
}

function updateBubbleBgPreviewUI(bgColor, { liveApply = false } = {}) {
  const palette = resolveBubblePalette(bgColor);

  const bubbleEl =
    document.getElementById('setting-bubble-preview-item') ||
    document.querySelector('#setting-ticker-preview .header-preview-bubble');
  const timeEl = document.querySelector('#setting-ticker-preview .header-preview-time');

  if (bubbleEl) {
    bubbleEl.style.backgroundColor = palette.bg;
    bubbleEl.style.borderColor = palette.border;
    bubbleEl.style.color = palette.text;
  }
  if (timeEl) {
    timeEl.style.color = palette.timeText;
  }

  document.querySelectorAll('#setting-bubble-bg-presets .bubble-bg-preset-chip').forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === palette.bg);
  });

  if (liveApply) {
    applyBubbleColor(palette.bg);
  }
}

function setBubbleBgColorInputs(bgColor, { liveApply = false } = {}) {
  const fallback = getStoredTheme() === 'light' ? DEFAULT_BUBBLE_BG_COLOR : DEFAULT_DARK_BUBBLE_BG_COLOR;
  const bg = normalizeHexColor(bgColor, fallback);
  const bgInput = document.getElementById('setting-bubble-bg-color');
  const bgHex = document.getElementById('setting-bubble-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateBubbleBgPreviewUI(bg, { liveApply });
}

function updateTickerPreviewUI(fgColor, bgColor) {
  const fg = normalizeHexColor(fgColor, DEFAULT_TICKER_FG_COLOR);
  const bg = normalizeHexColor(bgColor, DEFAULT_TICKER_BG_COLOR);

  document.querySelectorAll('#setting-ticker-preview .ticker-preview-chip').forEach(chip => {
    chip.style.color = fg;
    chip.style.backgroundColor = bg;
  });

  document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip').forEach(btn => {
    const pFg = (btn.getAttribute('data-fg') || '').toLowerCase();
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pFg === fg && pBg === bg);
  });
}

function setTickerColorInputs(fgColor, bgColor) {
  const fg = normalizeHexColor(fgColor, DEFAULT_TICKER_FG_COLOR);
  const bg = normalizeHexColor(bgColor, DEFAULT_TICKER_BG_COLOR);

  const fgInput = document.getElementById('setting-ticker-fg-color');
  const fgHex = document.getElementById('setting-ticker-fg-hex');
  const bgInput = document.getElementById('setting-ticker-bg-color');
  const bgHex = document.getElementById('setting-ticker-bg-hex');

  if (fgInput) fgInput.value = fg;
  if (fgHex) fgHex.value = fg;
  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateTickerPreviewUI(fg, bg);
}

function setMantineBtnLabel(btnEl, text) {
  if (!btnEl) return;
  const labelEl =
    btnEl.querySelector && btnEl.querySelector('.mantine-Button-label');
  if (labelEl) labelEl.textContent = text;
  else btnEl.textContent = text;
}

function refreshTickerStatsLabel() {
  const statsEl = document.getElementById('setting-ticker-stats-text');
  if (!statsEl) return;
  const stats = getTickerStats();
  const countStr = stats && stats.totalCount ? stats.totalCount.toLocaleString() : '9,600+';
  statsEl.textContent = t('settings.tickerStats', { count: countStr });
}

function refreshUpdateStatusUI(nextState = null) {
  if (nextState && typeof nextState === 'object') {
    currentUpdateState = {
      ...currentUpdateState,
      ...nextState
    };
  }

  const statusEl = document.getElementById('setting-update-status-text');
  const btnCheck = document.getElementById('btn-check-updates');
  const btnSettings = document.getElementById('btn-settings');

  const curVer = currentUpdateState.currentVersion || '1.0.0';
  const latestVer = currentUpdateState.latestVersion || curVer;
  const state = currentUpdateState.state || 'idle';
  const hasUpdate = !!(currentUpdateState.updateAvailable || state === 'downloaded');

  if (btnSettings) {
    btnSettings.classList.toggle('has-update-badge', hasUpdate);
  }

  if (state === 'checking') {
    if (statusEl) statusEl.textContent = t('settings.autoUpdateSubtitle', { version: curVer });
    if (btnCheck) {
      btnCheck.disabled = true;
      btnCheck.classList.remove('is-update-available', 'is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.checkingUpdatesBtn'));
    }
    return;
  }

  if (state === 'downloading') {
    const rawPct =
      typeof currentUpdateState.percent === 'number'
        ? currentUpdateState.percent
        : currentUpdateState.progress || 0;
    const pct = Math.max(0, Math.min(100, Math.round(rawPct)));
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateDownloadingSubtitle', {
        version: latestVer,
        percent: pct
      });
    }
    if (btnCheck) {
      btnCheck.disabled = true;
      btnCheck.classList.add('is-update-available');
      btnCheck.classList.remove('is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.downloadingUpdateBtn', { percent: pct }));
    }
    return;
  }

  if (state === 'downloaded') {
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateReadySubtitle', { version: latestVer });
    }
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.classList.remove('is-update-available');
      btnCheck.classList.add('is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.installUpdateBtn', { version: latestVer }));
    }
    return;
  }

  if (currentUpdateState.updateAvailable || state === 'available') {
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateAvailableSubtitle', {
        latest: latestVer,
        current: curVer
      });
    }
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.classList.add('is-update-available');
      btnCheck.classList.remove('is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.downloadUpdateBtn', { version: latestVer }));
    }
    return;
  }

  if (state === 'up-to-date') {
    if (statusEl) {
      statusEl.textContent = t('settings.autoUpdateUpToDateSubtitle', { version: curVer });
    }
    if (btnCheck) {
      btnCheck.disabled = false;
      btnCheck.classList.remove('is-update-available', 'is-update-ready');
      setMantineBtnLabel(btnCheck, t('settings.checkUpdatesBtn'));
    }
    return;
  }

  if (statusEl) {
    statusEl.textContent = t('settings.autoUpdateSubtitle', { version: curVer });
  }
  if (btnCheck) {
    btnCheck.disabled = false;
    btnCheck.classList.remove('is-update-available', 'is-update-ready');
    setMantineBtnLabel(btnCheck, t('settings.checkUpdatesBtn'));
  }
}

async function runSilentUpdateCheck() {
  if (!ipcRenderer || !getAutoCheckUpdates()) return;
  try {
    const res = await ipcRenderer.invoke('check-for-updates', { silent: true });
    if (res && res.ok) {
      refreshUpdateStatusUI(res);
      if (res.updateAvailable && res.latestVersion) {
        showToast(
          t('settings.toastUpdateAvailable', { version: res.latestVersion }),
          'info',
          4500
        );
      }
    }
  } catch (e) {
    // Ignore background update check network errors
  }
}

function startAutoUpdateCheck() {
  if (!ipcRenderer) return;
  ipcRenderer
    .invoke('get-update-state')
    .then((state) => {
      if (state && typeof state === 'object') {
        refreshUpdateStatusUI(state);
      }
    })
    .catch(() => {});

  if (autoUpdateIntervalId) {
    clearInterval(autoUpdateIntervalId);
  }
  // Check periodically every 4 hours when autoCheckUpdates is enabled
  autoUpdateIntervalId = setInterval(() => {
    runSilentUpdateCheck();
  }, 4 * 60 * 60 * 1000);

  if (process.env.THEYSAY_BACKGROUND_TEST !== '1') {
    setTimeout(() => {
      runSilentUpdateCheck();
    }, 3500);
  }
}

function loadCurrentSettings() {
  const languageSelect = document.getElementById('setting-language');
  if (languageSelect) {
    languageSelect.value = getLanguage();
  }

  INTERVAL_CONTROLS.forEach(({ selectId, wrapId, inputId, get }) => {
    const selectEl = document.getElementById(selectId);
    const wrapEl = document.getElementById(wrapId);
    const inputEl = document.getElementById(inputId);
    if (selectEl && wrapEl && inputEl) {
      populateSelectAndInput(selectEl, wrapEl, inputEl, get());
    }
  });

  BOOL_SELECT_CONTROLS.forEach(({ id, get }) => {
    const selectEl = document.getElementById(id);
    if (selectEl) {
      selectEl.value = get() ? 'true' : 'false';
    }
  });

  syncFilterKeywordsControl(getFilterKeywords());
  setChatBgColorInputs(getChatBgColor(), { liveApply: false });
  setBubbleBgColorInputs(getBubbleBgColor(), { liveApply: false });
  setHeaderColorInputs(getHeaderBgColor(), { liveApply: false });
  setTickerColorInputs(getTickerFgColor(), getTickerBgColor());
  refreshTickerStatsLabel();
  refreshUpdateStatusUI();
}

function openSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

  setActiveLanguageOverride(null);
  loadCurrentSettings();
  overlay.classList.remove('is-closed');
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.classList.add('active');
}

function closeSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

  commitPendingFilterKeywordsInput({ triggerSave: true });
  overlay.classList.add('is-closed');
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.classList.remove('active');
}

function readColorFromInputs(colorId, hexId, fallback) {
  const colorInput = document.getElementById(colorId);
  const hexInput = document.getElementById(hexId);
  return normalizeHexColor(
    hexInput ? hexInput.value : (colorInput && colorInput.value),
    fallback
  );
}

function getFormSettingsOverrides() {
  if (!isSettingsModalOpen()) return {};

  const languageSelect = document.getElementById('setting-language');
  const language =
    languageSelect && (languageSelect.value === 'zh' || languageSelect.value === 'en')
      ? languageSelect.value
      : getLanguage();

  const overrides = { language };

  INTERVAL_CONTROLS.forEach(({ key, selectId, inputId, get, normalize }) => {
    const selectEl = document.getElementById(selectId);
    const inputEl = document.getElementById(inputId);
    let mins = get();
    if (selectEl) {
      if (selectEl.value === 'custom' && inputEl) {
        const val = parseFloat(inputEl.value);
        if (!isNaN(val) && val > 0) mins = normalize(val);
      } else {
        const val = parseFloat(selectEl.value);
        if (!isNaN(val) && val > 0) mins = val;
      }
    }
    overrides[key] = mins;
  });

  BOOL_SELECT_CONTROLS.forEach(({ key, id, get }) => {
    const selectEl = document.getElementById(id);
    overrides[key] = selectEl ? selectEl.value === 'true' : get();
  });

  overrides.filterKeywords =
    typeof window !== 'undefined' && window.__THEYSAY_FILTER_KEYWORDS_BRIDGE
      ? window.__THEYSAY_FILTER_KEYWORDS_BRIDGE.getKeywords()
      : getFilterKeywords();
  overrides.headerBgColor = readColorFromInputs(
    'setting-header-bg-color',
    'setting-header-bg-hex',
    getHeaderBgColor()
  );
  overrides.chatBgColor = readColorFromInputs(
    'setting-chat-bg-color',
    'setting-chat-bg-hex',
    getChatBgColor()
  );
  overrides.bubbleBgColor = readColorFromInputs(
    'setting-bubble-bg-color',
    'setting-bubble-bg-hex',
    getBubbleBgColor()
  );
  overrides.tickerFgColor = readColorFromInputs(
    'setting-ticker-fg-color',
    'setting-ticker-fg-hex',
    getTickerFgColor()
  );
  overrides.tickerBgColor = readColorFromInputs(
    'setting-ticker-bg-color',
    'setting-ticker-bg-hex',
    getTickerBgColor()
  );

  return overrides;
}

function bindColorPair(colorInputEl, hexInputEl, defaultColor, onCommit) {
  if (!colorInputEl || !hexInputEl) return;
  colorInputEl.addEventListener('input', () => {
    const hex = normalizeHexColor(colorInputEl.value, defaultColor);
    hexInputEl.value = hex;
    onCommit(hex);
  });
  hexInputEl.addEventListener('input', () => {
    const raw = hexInputEl.value.trim();
    const parsed = raw ? colord(raw) : null;
    if (parsed && parsed.isValid() && /^#[0-9a-f]{6}$/i.test(raw)) {
      const hex = parsed.toHex();
      colorInputEl.value = hex;
      onCommit(hex);
    }
  });
  hexInputEl.addEventListener('blur', () => {
    const norm = normalizeHexColor(hexInputEl.value, colorInputEl.value || defaultColor);
    hexInputEl.value = norm;
    colorInputEl.value = norm;
    onCommit(norm);
  });
}

function initSettings({ onSave, onExportProfile, onImportProfile, onLanguageChange } = {}) {
  if (typeof onLanguageChange === 'function') {
    onLanguageChangeCallback = onLanguageChange;
  }
  if (typeof onSave === 'function') {
    onSaveCallback = onSave;
  }
  if (isInitialized) return;
  isInitialized = true;

  if (typeof window !== 'undefined') {
    window.__THEYSAY_ON_FILTER_KEYWORDS_CHANGE = (nextKeywords) => {
      saveFilterKeywords(nextKeywords);
      notifySaved();
    };
  }
  syncFilterKeywordsControl(getFilterKeywords());

  const btnSettings = document.getElementById('btn-settings');
  const overlay = getOverlay();
  const btnClose = document.getElementById('btn-settings-close');
  const btnReset = document.getElementById('btn-settings-reset');
  const languageSelect = document.getElementById('setting-language');
  const btnSyncTickers = document.getElementById('btn-sync-tickers');
  const btnCheckUpdates = document.getElementById('btn-check-updates');
  const btnExportProfile = document.getElementById('btn-export-profile');
  const btnImportProfile = document.getElementById('btn-import-profile');

  if (languageSelect) {
    languageSelect.addEventListener('change', () => {
      const nextLang = languageSelect.value === 'zh' ? 'zh' : 'en';
      saveLanguage(nextLang);
      refreshTickerStatsLabel();
      refreshUpdateStatusUI();
      if (typeof onLanguageChangeCallback === 'function') {
        onLanguageChangeCallback(nextLang);
      }
    });
  }

  if (btnCheckUpdates && ipcRenderer) {
    btnCheckUpdates.addEventListener('click', async () => {
      if (
        btnCheckUpdates.disabled ||
        currentUpdateState.state === 'checking' ||
        currentUpdateState.state === 'downloading'
      ) {
        return;
      }

      if (currentUpdateState.state === 'downloaded') {
        const targetVer =
          currentUpdateState.latestVersion || currentUpdateState.currentVersion || '1.0.0';
        showToast(t('settings.toastUpdateInstalling', { version: targetVer }), 'info', 3000);
        try {
          const res = await ipcRenderer.invoke('apply-downloaded-update');
          if (res && !res.ok && res.error) {
            showToast(t('settings.toastUpdateError', { error: res.error }), 'error', 3500);
          }
        } catch (err) {
          showToast(
            t('settings.toastUpdateError', { error: err.message || String(err) }),
            'error',
            3500
          );
        }
        return;
      }

      if (currentUpdateState.updateAvailable || currentUpdateState.state === 'available') {
        refreshUpdateStatusUI({ state: 'downloading', progress: 0 });
        try {
          const res = await ipcRenderer.invoke('download-update');
          if (res && res.ok) {
            refreshUpdateStatusUI({
              state: 'downloaded',
              latestVersion: res.version || currentUpdateState.latestVersion,
              progress: 100
            });
            showToast(
              t('settings.toastUpdateDownloaded', {
                version: res.version || currentUpdateState.latestVersion || '1.0.0'
              }),
              'success',
              3500
            );
          } else {
            refreshUpdateStatusUI({ state: 'available' });
            showToast(
              t('settings.toastUpdateError', {
                error: (res && res.error) || t('settings.networkErrorFallback')
              }),
              'error',
              3500
            );
          }
        } catch (err) {
          refreshUpdateStatusUI({ state: 'available' });
          showToast(
            t('settings.toastUpdateError', { error: err.message || String(err) }),
            'error',
            3500
          );
        }
        return;
      }

      refreshUpdateStatusUI({ state: 'checking' });
      try {
        const res = await ipcRenderer.invoke('check-for-updates', { silent: false });
        if (res && res.ok) {
          refreshUpdateStatusUI(res);
          if (res.updateAvailable) {
            showToast(
              t('settings.toastUpdateAvailable', { version: res.latestVersion }),
              'info',
              4000
            );
          } else {
            showToast(
              t('settings.toastUpToDate', {
                version: res.currentVersion || currentUpdateState.currentVersion
              }),
              'success',
              2500
            );
          }
        } else {
          refreshUpdateStatusUI(res || { state: 'error' });
          showToast(
            t('settings.toastUpdateError', {
              error: (res && res.error) || t('settings.networkErrorFallback')
            }),
            'warning',
            3000
          );
        }
      } catch (err) {
        refreshUpdateStatusUI({ state: 'error' });
        showToast(
          t('settings.toastUpdateError', { error: err.message || String(err) }),
          'warning',
          3000
        );
      }
    });
  }

  if (btnExportProfile) {
    btnExportProfile.addEventListener('click', () => {
      commitPendingFilterKeywordsInput({ triggerSave: true });
      if (typeof onExportProfile === 'function') {
        onExportProfile(getFormSettingsOverrides());
      }
    });
  }

  if (btnImportProfile) {
    btnImportProfile.addEventListener('click', () => {
      if (typeof onImportProfile === 'function') {
        onImportProfile();
      }
    });
  }

  if (btnSettings) {
    btnSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSettingsModalOpen()) {
        closeSettingsModal();
      } else {
        openSettingsModal();
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => closeSettingsModal());
  }

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeSettingsModal();
      }
    });
  }

  INTERVAL_CONTROLS.forEach(({ selectId, wrapId, inputId, get, save, normalize, errKey }) => {
    const selectEl = document.getElementById(selectId);
    const wrapEl = document.getElementById(wrapId);
    const inputEl = document.getElementById(inputId);
    if (!selectEl || !wrapEl || !inputEl) return;

    selectEl.addEventListener('change', () => {
      syncCustomVisibility(selectEl, wrapEl);
      if (selectEl.value === 'custom') {
        inputEl.focus();
        inputEl.select();
        const val = parseFloat(inputEl.value);
        if (!isNaN(val) && val > 0) {
          save(normalize(val));
          notifySaved();
        }
      } else {
        const mins = parseFloat(selectEl.value);
        if (!isNaN(mins) && mins > 0) {
          save(mins);
          notifySaved();
        }
      }
    });

    const commitCustom = () => {
      const val = parseFloat(inputEl.value);
      if (isNaN(val) || val <= 0) {
        showToast(t(errKey), 'error', 2500);
        inputEl.value = get();
        return;
      }
      const mins = normalize(val);
      inputEl.value = mins;
      save(mins);
      notifySaved();
    };

    inputEl.addEventListener('change', commitCustom);
    inputEl.addEventListener('blur', commitCustom);
  });

  BOOL_SELECT_CONTROLS.forEach(({ id, save }) => {
    const selectEl = document.getElementById(id);
    if (!selectEl) return;
    selectEl.addEventListener('change', () => {
      save(selectEl.value === 'true');
      notifySaved();
    });
  });

  const commitHeaderBg = (bg) => {
    const norm = normalizeHexColor(bg, DEFAULT_HEADER_BG_COLOR);
    saveHeaderBgColor(norm);
    updateHeaderPreviewUI(norm, { liveApply: true });
  };

  bindColorPair(
    document.getElementById('setting-header-bg-color'),
    document.getElementById('setting-header-bg-hex'),
    DEFAULT_HEADER_BG_COLOR,
    commitHeaderBg
  );

  document.querySelectorAll('#setting-header-presets .header-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const bg = btn.getAttribute('data-bg') || DEFAULT_HEADER_BG_COLOR;
      setHeaderColorInputs(bg, { liveApply: true });
      saveHeaderBgColor(normalizeHexColor(bg, DEFAULT_HEADER_BG_COLOR));
    });
  });

  const commitChatBg = (bg) => {
    const norm = normalizeHexColor(bg, DEFAULT_CHAT_BG_COLOR);
    saveChatBgColor(norm);
    updateChatBgPreviewUI(norm, { liveApply: true });
  };

  bindColorPair(
    document.getElementById('setting-chat-bg-color'),
    document.getElementById('setting-chat-bg-hex'),
    DEFAULT_CHAT_BG_COLOR,
    commitChatBg
  );

  document.querySelectorAll('#setting-chat-bg-presets .chat-bg-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const bg = btn.getAttribute('data-bg') || DEFAULT_CHAT_BG_COLOR;
      setChatBgColorInputs(bg, { liveApply: true });
      saveChatBgColor(normalizeHexColor(bg, DEFAULT_CHAT_BG_COLOR));
    });
  });

  const commitBubbleBg = (bg) => {
    const norm = normalizeHexColor(bg, DEFAULT_BUBBLE_BG_COLOR);
    saveBubbleBgColor(norm);
    updateBubbleBgPreviewUI(norm, { liveApply: true });
  };

  bindColorPair(
    document.getElementById('setting-bubble-bg-color'),
    document.getElementById('setting-bubble-bg-hex'),
    DEFAULT_BUBBLE_BG_COLOR,
    commitBubbleBg
  );

  document.querySelectorAll('#setting-bubble-bg-presets .bubble-bg-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const bg = btn.getAttribute('data-bg') || DEFAULT_BUBBLE_BG_COLOR;
      setBubbleBgColorInputs(bg, { liveApply: true });
      saveBubbleBgColor(normalizeHexColor(bg, DEFAULT_BUBBLE_BG_COLOR));
    });
  });

  const commitTickerState = () => {
    const fg = readColorFromInputs('setting-ticker-fg-color', 'setting-ticker-fg-hex', DEFAULT_TICKER_FG_COLOR);
    const bg = readColorFromInputs('setting-ticker-bg-color', 'setting-ticker-bg-hex', DEFAULT_TICKER_BG_COLOR);
    saveTickerFgColor(fg);
    saveTickerBgColor(bg);
    applyTickerColors(fg, bg);
    updateTickerPreviewUI(fg, bg);
  };

  bindColorPair(
    document.getElementById('setting-ticker-fg-color'),
    document.getElementById('setting-ticker-fg-hex'),
    DEFAULT_TICKER_FG_COLOR,
    commitTickerState
  );
  bindColorPair(
    document.getElementById('setting-ticker-bg-color'),
    document.getElementById('setting-ticker-bg-hex'),
    DEFAULT_TICKER_BG_COLOR,
    commitTickerState
  );

  document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const fg = btn.getAttribute('data-fg') || DEFAULT_TICKER_FG_COLOR;
      const bg = btn.getAttribute('data-bg') || DEFAULT_TICKER_BG_COLOR;
      setTickerColorInputs(fg, bg);
      commitTickerState();
    });
  });

  if (btnSyncTickers) {
    btnSyncTickers.addEventListener('click', async () => {
      if (btnSyncTickers.disabled) return;
      btnSyncTickers.disabled = true;
      setMantineBtnLabel(btnSyncTickers, t('settings.syncing'));
      try {
        const res = await syncOnlineTickers({ force: true });
        refreshTickerStatsLabel();
        if (res && res.ok) {
          showToast(
            t('settings.toastSyncSuccess', { count: (res.totalCount || 0).toLocaleString() }),
            'success',
            2500
          );
          if (typeof onSave === 'function') {
            onSave({ syncedTickersOnly: true });
          }
        } else {
          showToast(
            t('settings.toastSyncError', { error: (res && res.error) || t('settings.networkErrorFallback') }),
            'warning',
            2500
          );
        }
      } finally {
        btnSyncTickers.disabled = false;
        setMantineBtnLabel(btnSyncTickers, t('settings.syncOnlineBtn'));
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      clearStoredLanguage();
      const sysLang = detectSystemLanguage();
      if (languageSelect) {
        languageSelect.value = sysLang;
      }

      INTERVAL_CONTROLS.forEach(({ selectId, wrapId, inputId, save, defaultVal }) => {
        save(defaultVal);
        const selectEl = document.getElementById(selectId);
        const wrapEl = document.getElementById(wrapId);
        const inputEl = document.getElementById(inputId);
        if (selectEl && wrapEl && inputEl) {
          populateSelectAndInput(selectEl, wrapEl, inputEl, defaultVal);
        }
      });

      BOOL_SELECT_CONTROLS.forEach(({ id, save, defaultVal }) => {
        save(defaultVal);
        const selectEl = document.getElementById(id);
        if (selectEl) {
          selectEl.value = defaultVal ? 'true' : 'false';
        }
      });

      saveFilterKeywords(DEFAULT_FILTER_KEYWORDS);
      syncFilterKeywordsControl(DEFAULT_FILTER_KEYWORDS);

      const isDark = getStoredTheme() === 'dark';
      const defaultHeaderBg = isDark ? DEFAULT_DARK_HEADER_BG_COLOR : DEFAULT_HEADER_BG_COLOR;
      const defaultChatBg = isDark ? DEFAULT_DARK_CHAT_BG_COLOR : DEFAULT_CHAT_BG_COLOR;
      const defaultBubbleBg = isDark ? DEFAULT_DARK_BUBBLE_BG_COLOR : DEFAULT_BUBBLE_BG_COLOR;

      saveHeaderBgColor(defaultHeaderBg);
      applyHeaderColor(defaultHeaderBg);
      saveChatBgColor(defaultChatBg);
      applyChatBgColor(defaultChatBg);
      saveBubbleBgColor(defaultBubbleBg);
      applyBubbleColor(defaultBubbleBg);
      saveTickerFgColor(DEFAULT_TICKER_FG_COLOR);
      saveTickerBgColor(DEFAULT_TICKER_BG_COLOR);
      applyTickerColors(DEFAULT_TICKER_FG_COLOR, DEFAULT_TICKER_BG_COLOR);

      setChatBgColorInputs(defaultChatBg, { liveApply: true });
      setBubbleBgColorInputs(defaultBubbleBg, { liveApply: true });
      setHeaderColorInputs(defaultHeaderBg, { liveApply: true });
      setTickerColorInputs(DEFAULT_TICKER_FG_COLOR, DEFAULT_TICKER_BG_COLOR);

      if (typeof onLanguageChangeCallback === 'function') {
        onLanguageChangeCallback(sysLang);
      }
      refreshTickerStatsLabel();
      refreshUpdateStatusUI();
      notifySaved();
      showToast(t('settings.toastResetDefaults'), 'success', 2000);
    });
  }

  const handleEscKey = (e) => {
    if (e.key === 'Escape' && isSettingsModalOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsModal();
    }
  };

  window.addEventListener('keydown', handleEscKey, true);
  document.addEventListener('keydown', handleEscKey, true);

  if (ipcRenderer) {
    ipcRenderer.on('global-escape', () => {
      if (isSettingsModalOpen()) closeSettingsModal();
    });
    ipcRenderer.on('update-status', (event, status) => {
      if (status && typeof status === 'object') {
        refreshUpdateStatusUI(status);
      }
    });
  }

  refreshUpdateStatusUI();
}

module.exports = {
  initSettings,
  openSettingsModal,
  closeSettingsModal,
  isSettingsModalOpen,
  loadCurrentSettings,
  getFormSettingsOverrides,
  refreshTickerStatsLabel,
  refreshUpdateStatusUI,
  startAutoUpdateCheck
};
