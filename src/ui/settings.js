const { ipcRenderer } = require('electron');
const {
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_THREADS_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR,
  DEFAULT_HEADER_BG_COLOR
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
  getDiscordSoundEnabled,
  saveDiscordSoundEnabled,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor,
  getHeaderBgColor,
  saveHeaderBgColor,
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
  normalizeHexColor
} = require('./theme');
const { showToast } = require('../core/utils');
const {
  t,
  detectSystemLanguage,
  setActiveLanguageOverride
} = require('../core/i18n');

let isInitialized = false;
let onLanguageChangeCallback = null;

function getOverlay() {
  return document.getElementById('settings-modal-overlay');
}

function isSettingsModalOpen() {
  const overlay = getOverlay();
  return !!(overlay && !overlay.classList.contains('is-closed'));
}

function syncCustomVisibility(selectEl, customWrapEl) {
  if (selectEl.value === 'custom') {
    customWrapEl.style.display = 'flex';
  } else {
    customWrapEl.style.display = 'none';
  }
}

function populateSelectAndInput(selectEl, customWrapEl, customInputEl, currentVal) {
  const matchingOption = Array.from(selectEl.options).find(
    opt => opt.value !== 'custom' && parseFloat(opt.value) === currentVal
  );
  if (matchingOption) {
    selectEl.value = matchingOption.value;
    customWrapEl.style.display = 'none';
    customInputEl.value = currentVal;
  } else {
    selectEl.value = 'custom';
    customWrapEl.style.display = 'flex';
    customInputEl.value = currentVal;
  }
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
    barEl.style.borderBottomColor = palette.border;
  }
  if (nameEl) nameEl.style.color = palette.text;
  if (handleEl) handleEl.style.color = palette.subtext;
  if (dragEl) dragEl.style.color = palette.subtext;
  if (iconEl) iconEl.style.color = palette.subtext;

  const presetChips = document.querySelectorAll('#setting-header-presets .header-preset-chip');
  presetChips.forEach(btn => {
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pBg === palette.bg);
  });

  if (liveApply) {
    applyHeaderColor(palette.bg);
  }
}

function setHeaderColorInputs(bgColor, { liveApply = false } = {}) {
  const bg = normalizeHexColor(bgColor, DEFAULT_HEADER_BG_COLOR);
  const bgInput = document.getElementById('setting-header-bg-color');
  const bgHex = document.getElementById('setting-header-bg-hex');

  if (bgInput) bgInput.value = bg;
  if (bgHex) bgHex.value = bg;

  updateHeaderPreviewUI(bg, { liveApply });
}

function updateTickerPreviewUI(fgColor, bgColor) {
  const fg = normalizeHexColor(fgColor, DEFAULT_TICKER_FG_COLOR);
  const bg = normalizeHexColor(bgColor, DEFAULT_TICKER_BG_COLOR);

  const previewChips = document.querySelectorAll('#setting-ticker-preview .ticker-preview-chip');
  previewChips.forEach(chip => {
    chip.style.color = fg;
    chip.style.backgroundColor = bg;
  });

  const presetChips = document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip');
  presetChips.forEach(btn => {
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

function refreshTickerStatsLabel() {
  const statsEl = document.getElementById('setting-ticker-stats-text');
  if (!statsEl) return;
  const stats = getTickerStats();
  const countStr = stats && stats.totalCount ? stats.totalCount.toLocaleString() : '9,600+';
  statsEl.textContent = t('settings.tickerStats', { count: countStr });
}

function loadCurrentSettings() {
  const languageSelect = document.getElementById('setting-language');
  if (languageSelect) {
    languageSelect.value = getLanguage();
  }

  const twitterSelect = document.getElementById('setting-twitter-interval');
  const twitterCustomWrap = document.getElementById('setting-twitter-custom-wrap');
  const twitterCustomInput = document.getElementById('setting-twitter-custom');

  const threadsSelect = document.getElementById('setting-threads-interval');
  const threadsCustomWrap = document.getElementById('setting-threads-custom-wrap');
  const threadsCustomInput = document.getElementById('setting-threads-custom');

  const discordSelect = document.getElementById('setting-discord-interval');
  const discordCustomWrap = document.getElementById('setting-discord-custom-wrap');
  const discordCustomInput = document.getElementById('setting-discord-custom');

  if (twitterSelect && twitterCustomWrap && twitterCustomInput) {
    const twitterVal = getTwitterIntervalMinutes();
    populateSelectAndInput(twitterSelect, twitterCustomWrap, twitterCustomInput, twitterVal);
  }

  if (threadsSelect && threadsCustomWrap && threadsCustomInput) {
    const threadsVal = getThreadsIntervalMinutes();
    populateSelectAndInput(threadsSelect, threadsCustomWrap, threadsCustomInput, threadsVal);
  }

  if (discordSelect && discordCustomWrap && discordCustomInput) {
    const discordVal = getDiscordIntervalMinutes();
    populateSelectAndInput(discordSelect, discordCustomWrap, discordCustomInput, discordVal);
  }

  const memberOnlySelect = document.getElementById('setting-show-member-only');
  if (memberOnlySelect) {
    const showMemberOnly = getShowMemberOnlyPosts();
    memberOnlySelect.value = showMemberOnly ? 'true' : 'false';
  }

  const discordSoundSelect = document.getElementById('setting-discord-sound');
  if (discordSoundSelect) {
    discordSoundSelect.value = getDiscordSoundEnabled() ? 'true' : 'false';
  }

  setHeaderColorInputs(getHeaderBgColor(), { liveApply: false });
  setTickerColorInputs(getTickerFgColor(), getTickerBgColor());
  refreshTickerStatsLabel();
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

  overlay.classList.add('is-closed');
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.classList.remove('active');
}

function getFormSettingsOverrides() {
  if (!isSettingsModalOpen()) return {};

  const languageSelect = document.getElementById('setting-language');
  const twitterSelect = document.getElementById('setting-twitter-interval');
  const twitterCustomInput = document.getElementById('setting-twitter-custom');
  const threadsSelect = document.getElementById('setting-threads-interval');
  const threadsCustomInput = document.getElementById('setting-threads-custom');
  const discordSelect = document.getElementById('setting-discord-interval');
  const discordCustomInput = document.getElementById('setting-discord-custom');
  const memberOnlySelect = document.getElementById('setting-show-member-only');
  const discordSoundSelect = document.getElementById('setting-discord-sound');
  const headerBgInput = document.getElementById('setting-header-bg-color');
  const headerBgHex = document.getElementById('setting-header-bg-hex');
  const tickerFgInput = document.getElementById('setting-ticker-fg-color');
  const tickerFgHex = document.getElementById('setting-ticker-fg-hex');
  const tickerBgInput = document.getElementById('setting-ticker-bg-color');
  const tickerBgHex = document.getElementById('setting-ticker-bg-hex');

  const language =
    languageSelect && (languageSelect.value === 'zh' || languageSelect.value === 'en')
      ? languageSelect.value
      : getLanguage();

  let twitterIntervalMinutes = getTwitterIntervalMinutes();
  if (twitterSelect) {
    if (twitterSelect.value === 'custom' && twitterCustomInput) {
      const val = parseFloat(twitterCustomInput.value);
      if (!isNaN(val) && val > 0) twitterIntervalMinutes = Math.max(1, Math.round(val));
    } else {
      const val = parseFloat(twitterSelect.value);
      if (!isNaN(val) && val > 0) twitterIntervalMinutes = val;
    }
  }

  let threadsIntervalMinutes = getThreadsIntervalMinutes();
  if (threadsSelect) {
    if (threadsSelect.value === 'custom' && threadsCustomInput) {
      const val = parseFloat(threadsCustomInput.value);
      if (!isNaN(val) && val > 0) threadsIntervalMinutes = Math.max(1, Math.round(val));
    } else {
      const val = parseFloat(threadsSelect.value);
      if (!isNaN(val) && val > 0) threadsIntervalMinutes = val;
    }
  }

  let discordIntervalMinutes = getDiscordIntervalMinutes();
  if (discordSelect) {
    if (discordSelect.value === 'custom' && discordCustomInput) {
      const val = parseFloat(discordCustomInput.value);
      if (!isNaN(val) && val > 0) discordIntervalMinutes = Math.max(0.5, Math.round(val * 10) / 10);
    } else {
      const val = parseFloat(discordSelect.value);
      if (!isNaN(val) && val > 0) discordIntervalMinutes = val;
    }
  }

  const showMemberOnlyPosts = memberOnlySelect
    ? memberOnlySelect.value === 'true'
    : getShowMemberOnlyPosts();
  const discordSoundEnabled = discordSoundSelect
    ? discordSoundSelect.value === 'true'
    : getDiscordSoundEnabled();
  const headerBgColor = normalizeHexColor(
    headerBgHex ? headerBgHex.value : (headerBgInput && headerBgInput.value),
    getHeaderBgColor()
  );
  const tickerFgColor = normalizeHexColor(
    tickerFgHex ? tickerFgHex.value : (tickerFgInput && tickerFgInput.value),
    getTickerFgColor()
  );
  const tickerBgColor = normalizeHexColor(
    tickerBgHex ? tickerBgHex.value : (tickerBgInput && tickerBgInput.value),
    getTickerBgColor()
  );

  return {
    language,
    twitterIntervalMinutes,
    threadsIntervalMinutes,
    discordIntervalMinutes,
    showMemberOnlyPosts,
    discordSoundEnabled,
    headerBgColor,
    tickerFgColor,
    tickerBgColor
  };
}

function initSettings({ onSave, onExportProfile, onImportProfile, onLanguageChange } = {}) {
  if (typeof onLanguageChange === 'function') {
    onLanguageChangeCallback = onLanguageChange;
  }
  if (isInitialized) return;
  isInitialized = true;

  const btnSettings = document.getElementById('btn-settings');
  const overlay = getOverlay();
  const btnClose = document.getElementById('btn-settings-close');
  const btnReset = document.getElementById('btn-settings-reset');

  const languageSelect = document.getElementById('setting-language');

  const twitterSelect = document.getElementById('setting-twitter-interval');
  const twitterCustomWrap = document.getElementById('setting-twitter-custom-wrap');
  const twitterCustomInput = document.getElementById('setting-twitter-custom');

  const threadsSelect = document.getElementById('setting-threads-interval');
  const threadsCustomWrap = document.getElementById('setting-threads-custom-wrap');
  const threadsCustomInput = document.getElementById('setting-threads-custom');

  const discordSelect = document.getElementById('setting-discord-interval');
  const discordCustomWrap = document.getElementById('setting-discord-custom-wrap');
  const discordCustomInput = document.getElementById('setting-discord-custom');

  const memberOnlySelect = document.getElementById('setting-show-member-only');
  const discordSoundSelect = document.getElementById('setting-discord-sound');

  const headerBgInput = document.getElementById('setting-header-bg-color');
  const headerBgHex = document.getElementById('setting-header-bg-hex');

  const tickerFgInput = document.getElementById('setting-ticker-fg-color');
  const tickerFgHex = document.getElementById('setting-ticker-fg-hex');
  const tickerBgInput = document.getElementById('setting-ticker-bg-color');
  const tickerBgHex = document.getElementById('setting-ticker-bg-hex');
  const btnSyncTickers = document.getElementById('btn-sync-tickers');
  const btnExportProfile = document.getElementById('btn-export-profile');
  const btnImportProfile = document.getElementById('btn-import-profile');

  const notifySaved = () => {
    if (typeof onSave === 'function') {
      onSave({
        language: getLanguage(),
        twitterMinutes: getTwitterIntervalMinutes(),
        threadsMinutes: getThreadsIntervalMinutes(),
        discordMinutes: getDiscordIntervalMinutes(),
        showMemberOnly: getShowMemberOnlyPosts(),
        discordSoundEnabled: getDiscordSoundEnabled(),
        headerBgColor: getHeaderBgColor(),
        tickerFgColor: getTickerFgColor(),
        tickerBgColor: getTickerBgColor()
      });
    }
  };

  if (languageSelect) {
    languageSelect.addEventListener('change', () => {
      const nextLang = languageSelect.value === 'zh' ? 'zh' : 'en';
      saveLanguage(nextLang);
      refreshTickerStatsLabel();
      if (typeof onLanguageChangeCallback === 'function') {
        onLanguageChangeCallback(nextLang);
      }
    });
  }

  if (btnExportProfile) {
    btnExportProfile.addEventListener('click', () => {
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

  if (twitterSelect && twitterCustomWrap && twitterCustomInput) {
    twitterSelect.addEventListener('change', () => {
      syncCustomVisibility(twitterSelect, twitterCustomWrap);
      if (twitterSelect.value === 'custom') {
        twitterCustomInput.focus();
        twitterCustomInput.select();
        const val = parseFloat(twitterCustomInput.value);
        if (!isNaN(val) && val > 0) {
          saveTwitterIntervalMinutes(Math.max(1, Math.round(val)));
          notifySaved();
        }
      } else {
        const mins = parseFloat(twitterSelect.value);
        if (!isNaN(mins) && mins > 0) {
          saveTwitterIntervalMinutes(mins);
          notifySaved();
        }
      }
    });

    const commitTwitterCustom = ({ showErr = false } = {}) => {
      const val = parseFloat(twitterCustomInput.value);
      if (isNaN(val) || val <= 0) {
        if (showErr) {
          showToast(t('settings.toastInvalidTwitterInterval'), 'error', 2500);
          twitterCustomInput.value = getTwitterIntervalMinutes();
        }
        return;
      }
      const mins = Math.max(1, Math.round(val));
      if (showErr) twitterCustomInput.value = mins;
      saveTwitterIntervalMinutes(mins);
      notifySaved();
    };

    twitterCustomInput.addEventListener('change', () => commitTwitterCustom({ showErr: true }));
    twitterCustomInput.addEventListener('blur', () => commitTwitterCustom({ showErr: true }));
  }

  if (threadsSelect && threadsCustomWrap && threadsCustomInput) {
    threadsSelect.addEventListener('change', () => {
      syncCustomVisibility(threadsSelect, threadsCustomWrap);
      if (threadsSelect.value === 'custom') {
        threadsCustomInput.focus();
        threadsCustomInput.select();
        const val = parseFloat(threadsCustomInput.value);
        if (!isNaN(val) && val > 0) {
          saveThreadsIntervalMinutes(Math.max(1, Math.round(val)));
          notifySaved();
        }
      } else {
        const mins = parseFloat(threadsSelect.value);
        if (!isNaN(mins) && mins > 0) {
          saveThreadsIntervalMinutes(mins);
          notifySaved();
        }
      }
    });

    const commitThreadsCustom = ({ showErr = false } = {}) => {
      const val = parseFloat(threadsCustomInput.value);
      if (isNaN(val) || val <= 0) {
        if (showErr) {
          showToast(t('settings.toastInvalidThreadsInterval'), 'error', 2500);
          threadsCustomInput.value = getThreadsIntervalMinutes();
        }
        return;
      }
      const mins = Math.max(1, Math.round(val));
      if (showErr) threadsCustomInput.value = mins;
      saveThreadsIntervalMinutes(mins);
      notifySaved();
    };

    threadsCustomInput.addEventListener('change', () => commitThreadsCustom({ showErr: true }));
    threadsCustomInput.addEventListener('blur', () => commitThreadsCustom({ showErr: true }));
  }

  if (discordSelect && discordCustomWrap && discordCustomInput) {
    discordSelect.addEventListener('change', () => {
      syncCustomVisibility(discordSelect, discordCustomWrap);
      if (discordSelect.value === 'custom') {
        discordCustomInput.focus();
        discordCustomInput.select();
        const val = parseFloat(discordCustomInput.value);
        if (!isNaN(val) && val > 0) {
          saveDiscordIntervalMinutes(Math.max(0.5, Math.round(val * 10) / 10));
          notifySaved();
        }
      } else {
        const mins = parseFloat(discordSelect.value);
        if (!isNaN(mins) && mins > 0) {
          saveDiscordIntervalMinutes(mins);
          notifySaved();
        }
      }
    });

    const commitDiscordCustom = ({ showErr = false } = {}) => {
      const val = parseFloat(discordCustomInput.value);
      if (isNaN(val) || val <= 0) {
        if (showErr) {
          showToast(t('settings.toastInvalidDiscordInterval'), 'error', 2500);
          discordCustomInput.value = getDiscordIntervalMinutes();
        }
        return;
      }
      const mins = Math.max(0.5, Math.round(val * 10) / 10);
      if (showErr) discordCustomInput.value = mins;
      saveDiscordIntervalMinutes(mins);
      notifySaved();
    };

    discordCustomInput.addEventListener('change', () => commitDiscordCustom({ showErr: true }));
    discordCustomInput.addEventListener('blur', () => commitDiscordCustom({ showErr: true }));
  }

  if (memberOnlySelect) {
    memberOnlySelect.addEventListener('change', () => {
      const showMemberOnly = memberOnlySelect.value === 'true';
      saveShowMemberOnlyPosts(showMemberOnly);
      notifySaved();
    });
  }

  if (discordSoundSelect) {
    discordSoundSelect.addEventListener('change', () => {
      const discordSoundEnabled = discordSoundSelect.value === 'true';
      saveDiscordSoundEnabled(discordSoundEnabled);
      notifySaved();
    });
  }

  const getCurrentFormHeaderBg = () =>
    normalizeHexColor(
      headerBgHex ? headerBgHex.value : (headerBgInput && headerBgInput.value),
      DEFAULT_HEADER_BG_COLOR
    );

  const commitHeaderBg = (bg) => {
    const norm = normalizeHexColor(bg, DEFAULT_HEADER_BG_COLOR);
    saveHeaderBgColor(norm);
    updateHeaderPreviewUI(norm, { liveApply: true });
  };

  if (headerBgInput && headerBgHex) {
    headerBgInput.addEventListener('input', () => {
      headerBgHex.value = headerBgInput.value.toLowerCase();
      commitHeaderBg(getCurrentFormHeaderBg());
    });
    headerBgHex.addEventListener('input', () => {
      const val = headerBgHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        headerBgInput.value = val.toLowerCase();
        commitHeaderBg(val.toLowerCase());
      }
    });
    headerBgHex.addEventListener('blur', () => {
      const norm = normalizeHexColor(
        headerBgHex.value,
        headerBgInput.value || DEFAULT_HEADER_BG_COLOR
      );
      headerBgHex.value = norm;
      headerBgInput.value = norm;
      commitHeaderBg(norm);
    });
  }

  document.querySelectorAll('#setting-header-presets .header-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const bg = btn.getAttribute('data-bg') || DEFAULT_HEADER_BG_COLOR;
      setHeaderColorInputs(bg, { liveApply: true });
      saveHeaderBgColor(normalizeHexColor(bg, DEFAULT_HEADER_BG_COLOR));
    });
  });

  const getCurrentFormTickerColors = () => ({
    fg: normalizeHexColor(tickerFgHex ? tickerFgHex.value : (tickerFgInput && tickerFgInput.value), DEFAULT_TICKER_FG_COLOR),
    bg: normalizeHexColor(tickerBgHex ? tickerBgHex.value : (tickerBgInput && tickerBgInput.value), DEFAULT_TICKER_BG_COLOR)
  });

  const commitTickerState = () => {
    const { fg, bg } = getCurrentFormTickerColors();
    saveTickerFgColor(fg);
    saveTickerBgColor(bg);
    applyTickerColors(fg, bg);
    updateTickerPreviewUI(fg, bg);
  };

  if (tickerFgInput && tickerFgHex) {
    tickerFgInput.addEventListener('input', () => {
      tickerFgHex.value = tickerFgInput.value.toLowerCase();
      commitTickerState();
    });
    tickerFgHex.addEventListener('input', () => {
      const val = tickerFgHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        tickerFgInput.value = val.toLowerCase();
        commitTickerState();
      }
    });
    tickerFgHex.addEventListener('blur', () => {
      const norm = normalizeHexColor(tickerFgHex.value, tickerFgInput.value || DEFAULT_TICKER_FG_COLOR);
      tickerFgHex.value = norm;
      tickerFgInput.value = norm;
      commitTickerState();
    });
  }

  if (tickerBgInput && tickerBgHex) {
    tickerBgInput.addEventListener('input', () => {
      tickerBgHex.value = tickerBgInput.value.toLowerCase();
      commitTickerState();
    });
    tickerBgHex.addEventListener('input', () => {
      const val = tickerBgHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        tickerBgInput.value = val.toLowerCase();
        commitTickerState();
      }
    });
    tickerBgHex.addEventListener('blur', () => {
      const norm = normalizeHexColor(tickerBgHex.value, tickerBgInput.value || DEFAULT_TICKER_BG_COLOR);
      tickerBgHex.value = norm;
      tickerBgInput.value = norm;
      commitTickerState();
    });
  }

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
      btnSyncTickers.textContent = t('settings.syncing');
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
        btnSyncTickers.textContent = t('settings.syncOnlineBtn');
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

      saveTwitterIntervalMinutes(DEFAULT_TWITTER_INTERVAL_MINUTES);
      saveThreadsIntervalMinutes(DEFAULT_THREADS_INTERVAL_MINUTES);
      saveDiscordIntervalMinutes(DEFAULT_DISCORD_INTERVAL_MINUTES);
      saveShowMemberOnlyPosts(DEFAULT_SHOW_MEMBER_ONLY);
      saveDiscordSoundEnabled(DEFAULT_DISCORD_SOUND_ENABLED);
      saveHeaderBgColor(DEFAULT_HEADER_BG_COLOR);
      applyHeaderColor(DEFAULT_HEADER_BG_COLOR);
      saveTickerFgColor(DEFAULT_TICKER_FG_COLOR);
      saveTickerBgColor(DEFAULT_TICKER_BG_COLOR);
      applyTickerColors(DEFAULT_TICKER_FG_COLOR, DEFAULT_TICKER_BG_COLOR);

      if (twitterSelect && twitterCustomWrap && twitterCustomInput) {
        populateSelectAndInput(
          twitterSelect,
          twitterCustomWrap,
          twitterCustomInput,
          DEFAULT_TWITTER_INTERVAL_MINUTES
        );
      }
      if (threadsSelect && threadsCustomWrap && threadsCustomInput) {
        populateSelectAndInput(
          threadsSelect,
          threadsCustomWrap,
          threadsCustomInput,
          DEFAULT_THREADS_INTERVAL_MINUTES
        );
      }
      if (discordSelect && discordCustomWrap && discordCustomInput) {
        populateSelectAndInput(
          discordSelect,
          discordCustomWrap,
          discordCustomInput,
          DEFAULT_DISCORD_INTERVAL_MINUTES
        );
      }
      if (memberOnlySelect) {
        memberOnlySelect.value = DEFAULT_SHOW_MEMBER_ONLY ? 'true' : 'false';
      }
      if (discordSoundSelect) {
        discordSoundSelect.value = DEFAULT_DISCORD_SOUND_ENABLED ? 'true' : 'false';
      }
      setHeaderColorInputs(DEFAULT_HEADER_BG_COLOR, { liveApply: true });
      setTickerColorInputs(DEFAULT_TICKER_FG_COLOR, DEFAULT_TICKER_BG_COLOR);

      if (typeof onLanguageChangeCallback === 'function') {
        onLanguageChangeCallback(sysLang);
      }
      refreshTickerStatsLabel();
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
  }
}

module.exports = {
  initSettings,
  openSettingsModal,
  closeSettingsModal,
  isSettingsModalOpen,
  loadCurrentSettings,
  getFormSettingsOverrides,
  refreshTickerStatsLabel
};
