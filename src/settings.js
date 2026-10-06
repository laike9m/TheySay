const { ipcRenderer } = require('electron');
const {
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY,
  DEFAULT_DISCORD_SOUND_ENABLED,
  DEFAULT_TICKER_HIGHLIGHT_ENABLED,
  DEFAULT_TICKER_FG_COLOR,
  DEFAULT_TICKER_BG_COLOR
} = require('./constants');
const {
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getShowMemberOnlyTweets,
  saveShowMemberOnlyTweets,
  getDiscordSoundEnabled,
  saveDiscordSoundEnabled,
  getTickerHighlightEnabled,
  saveTickerHighlightEnabled,
  getTickerFgColor,
  saveTickerFgColor,
  getTickerBgColor,
  saveTickerBgColor
} = require('./storage');
const {
  applyTickerColors,
  syncOnlineTickers,
  getTickerStats
} = require('./ticker');
const { showToast } = require('./utils');

let isInitialized = false;

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

function normalizeHexColor(val, fallback) {
  const str = String(val || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(str)) {
    return str.toLowerCase();
  }
  if (/^[0-9A-Fa-f]{6}$/.test(str)) {
    return `#${str.toLowerCase()}`;
  }
  return fallback;
}

function updateTickerPreviewUI(fgColor, bgColor, enabled = true) {
  const fg = normalizeHexColor(fgColor, DEFAULT_TICKER_FG_COLOR);
  const bg = normalizeHexColor(bgColor, DEFAULT_TICKER_BG_COLOR);

  const colorsWrap = document.getElementById('setting-ticker-colors-wrap');
  if (colorsWrap) {
    colorsWrap.classList.toggle('is-disabled', !enabled);
  }

  const previewChips = document.querySelectorAll('#setting-ticker-preview .ticker-preview-chip');
  previewChips.forEach(chip => {
    if (enabled) {
      chip.style.color = fg;
      chip.style.backgroundColor = bg;
      chip.style.fontWeight = '700';
      chip.style.padding = '1px 5px';
    } else {
      chip.style.color = 'inherit';
      chip.style.backgroundColor = 'transparent';
      chip.style.fontWeight = '400';
      chip.style.padding = '0';
    }
  });

  const presetChips = document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip');
  presetChips.forEach(btn => {
    const pFg = (btn.getAttribute('data-fg') || '').toLowerCase();
    const pBg = (btn.getAttribute('data-bg') || '').toLowerCase();
    btn.classList.toggle('active', pFg === fg && pBg === bg);
  });
}

function setTickerColorInputs(fgColor, bgColor, enabled = true) {
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

  updateTickerPreviewUI(fg, bg, enabled);
}

function refreshTickerStatsLabel() {
  const statsEl = document.getElementById('setting-ticker-stats-text');
  if (!statsEl) return;
  const stats = getTickerStats();
  const countStr = stats && stats.totalCount ? stats.totalCount.toLocaleString() : '9,600+';
  statsEl.textContent = `已加载 ${countStr} 个 NASDAQ 美股与 ETF 代码，支持 $ 符号与大小写自动匹配（自动排除普通英文单词）。`;
}

function loadCurrentSettings() {
  const twitterSelect = document.getElementById('setting-twitter-interval');
  const twitterCustomWrap = document.getElementById('setting-twitter-custom-wrap');
  const twitterCustomInput = document.getElementById('setting-twitter-custom');

  const discordSelect = document.getElementById('setting-discord-interval');
  const discordCustomWrap = document.getElementById('setting-discord-custom-wrap');
  const discordCustomInput = document.getElementById('setting-discord-custom');

  if (twitterSelect && twitterCustomWrap && twitterCustomInput) {
    const twitterVal = getTwitterIntervalMinutes();
    populateSelectAndInput(twitterSelect, twitterCustomWrap, twitterCustomInput, twitterVal);
  }

  if (discordSelect && discordCustomWrap && discordCustomInput) {
    const discordVal = getDiscordIntervalMinutes();
    populateSelectAndInput(discordSelect, discordCustomWrap, discordCustomInput, discordVal);
  }

  const memberOnlySelect = document.getElementById('setting-show-member-only');
  if (memberOnlySelect) {
    const showMemberOnly = getShowMemberOnlyTweets();
    memberOnlySelect.value = showMemberOnly ? 'true' : 'false';
  }

  const discordSoundSelect = document.getElementById('setting-discord-sound');
  if (discordSoundSelect) {
    discordSoundSelect.value = getDiscordSoundEnabled() ? 'true' : 'false';
  }

  const tickerEnabledSelect = document.getElementById('setting-ticker-enabled');
  const tickerEnabled = getTickerHighlightEnabled();
  if (tickerEnabledSelect) {
    tickerEnabledSelect.value = tickerEnabled ? 'true' : 'false';
  }

  setTickerColorInputs(getTickerFgColor(), getTickerBgColor(), tickerEnabled);
  refreshTickerStatsLabel();
}

function openSettingsModal() {
  const overlay = getOverlay();
  if (!overlay) return;

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

function initSettings({ onSave } = {}) {
  if (isInitialized) return;
  isInitialized = true;

  const btnSettings = document.getElementById('btn-settings');
  const overlay = getOverlay();
  const btnClose = document.getElementById('btn-settings-close');
  const btnCancel = document.getElementById('btn-settings-cancel');
  const btnSave = document.getElementById('btn-settings-save');
  const btnReset = document.getElementById('btn-settings-reset');

  const twitterSelect = document.getElementById('setting-twitter-interval');
  const twitterCustomWrap = document.getElementById('setting-twitter-custom-wrap');
  const twitterCustomInput = document.getElementById('setting-twitter-custom');

  const discordSelect = document.getElementById('setting-discord-interval');
  const discordCustomWrap = document.getElementById('setting-discord-custom-wrap');
  const discordCustomInput = document.getElementById('setting-discord-custom');

  const tickerEnabledSelect = document.getElementById('setting-ticker-enabled');
  const tickerFgInput = document.getElementById('setting-ticker-fg-color');
  const tickerFgHex = document.getElementById('setting-ticker-fg-hex');
  const tickerBgInput = document.getElementById('setting-ticker-bg-color');
  const tickerBgHex = document.getElementById('setting-ticker-bg-hex');
  const btnSyncTickers = document.getElementById('btn-sync-tickers');

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
    btnClose.addEventListener('click', closeSettingsModal);
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', closeSettingsModal);
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
      }
    });
  }

  if (discordSelect && discordCustomWrap && discordCustomInput) {
    discordSelect.addEventListener('change', () => {
      syncCustomVisibility(discordSelect, discordCustomWrap);
      if (discordSelect.value === 'custom') {
        discordCustomInput.focus();
        discordCustomInput.select();
      }
    });
  }

  const getCurrentFormTickerState = () => ({
    enabled: !tickerEnabledSelect || tickerEnabledSelect.value === 'true',
    fg: normalizeHexColor(tickerFgHex ? tickerFgHex.value : (tickerFgInput && tickerFgInput.value), DEFAULT_TICKER_FG_COLOR),
    bg: normalizeHexColor(tickerBgHex ? tickerBgHex.value : (tickerBgInput && tickerBgInput.value), DEFAULT_TICKER_BG_COLOR)
  });

  if (tickerEnabledSelect) {
    tickerEnabledSelect.addEventListener('change', () => {
      const { enabled, fg, bg } = getCurrentFormTickerState();
      updateTickerPreviewUI(fg, bg, enabled);
    });
  }

  if (tickerFgInput && tickerFgHex) {
    tickerFgInput.addEventListener('input', () => {
      tickerFgHex.value = tickerFgInput.value.toLowerCase();
      const { enabled, fg, bg } = getCurrentFormTickerState();
      updateTickerPreviewUI(fg, bg, enabled);
    });
    tickerFgHex.addEventListener('input', () => {
      const val = tickerFgHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        tickerFgInput.value = val.toLowerCase();
        const { enabled, fg, bg } = getCurrentFormTickerState();
        updateTickerPreviewUI(fg, bg, enabled);
      }
    });
    tickerFgHex.addEventListener('blur', () => {
      const norm = normalizeHexColor(tickerFgHex.value, tickerFgInput.value || DEFAULT_TICKER_FG_COLOR);
      tickerFgHex.value = norm;
      tickerFgInput.value = norm;
    });
  }

  if (tickerBgInput && tickerBgHex) {
    tickerBgInput.addEventListener('input', () => {
      tickerBgHex.value = tickerBgInput.value.toLowerCase();
      const { enabled, fg, bg } = getCurrentFormTickerState();
      updateTickerPreviewUI(fg, bg, enabled);
    });
    tickerBgHex.addEventListener('input', () => {
      const val = tickerBgHex.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        tickerBgInput.value = val.toLowerCase();
        const { enabled, fg, bg } = getCurrentFormTickerState();
        updateTickerPreviewUI(fg, bg, enabled);
      }
    });
    tickerBgHex.addEventListener('blur', () => {
      const norm = normalizeHexColor(tickerBgHex.value, tickerBgInput.value || DEFAULT_TICKER_BG_COLOR);
      tickerBgHex.value = norm;
      tickerBgInput.value = norm;
    });
  }

  document.querySelectorAll('#setting-ticker-presets .ticker-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const fg = btn.getAttribute('data-fg') || DEFAULT_TICKER_FG_COLOR;
      const bg = btn.getAttribute('data-bg') || DEFAULT_TICKER_BG_COLOR;
      const enabled = !tickerEnabledSelect || tickerEnabledSelect.value === 'true';
      setTickerColorInputs(fg, bg, enabled);
    });
  });

  if (btnSyncTickers) {
    btnSyncTickers.addEventListener('click', async () => {
      if (btnSyncTickers.disabled) return;
      const origText = btnSyncTickers.textContent;
      btnSyncTickers.disabled = true;
      btnSyncTickers.textContent = '同步中...';
      try {
        const res = await syncOnlineTickers({ force: true });
        refreshTickerStatsLabel();
        if (res && res.ok) {
          showToast(
            `NASDAQ 词库同步完成，当前共收录 ${(res.totalCount || 0).toLocaleString()} 个股票/ETF 代码`,
            'success',
            2500
          );
          if (typeof onSave === 'function') {
            onSave({ syncedTickersOnly: true });
          }
        } else {
          showToast(`在线同步失败，已使用内置词库 (${(res && res.error) || '网络异常'})`, 'warning', 2500);
        }
      } finally {
        btnSyncTickers.disabled = false;
        btnSyncTickers.textContent = origText;
      }
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (twitterSelect && twitterCustomWrap && twitterCustomInput) {
        populateSelectAndInput(
          twitterSelect,
          twitterCustomWrap,
          twitterCustomInput,
          DEFAULT_TWITTER_INTERVAL_MINUTES
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
      const memberOnlySelect = document.getElementById('setting-show-member-only');
      if (memberOnlySelect) {
        memberOnlySelect.value = DEFAULT_SHOW_MEMBER_ONLY ? 'true' : 'false';
      }
      const discordSoundSelect = document.getElementById('setting-discord-sound');
      if (discordSoundSelect) {
        discordSoundSelect.value = DEFAULT_DISCORD_SOUND_ENABLED ? 'true' : 'false';
      }
      if (tickerEnabledSelect) {
        tickerEnabledSelect.value = DEFAULT_TICKER_HIGHLIGHT_ENABLED ? 'true' : 'false';
      }
      setTickerColorInputs(
        DEFAULT_TICKER_FG_COLOR,
        DEFAULT_TICKER_BG_COLOR,
        DEFAULT_TICKER_HIGHLIGHT_ENABLED
      );
      showToast('已恢复默认参数，点击“保存设置”生效', 'info', 2000);
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', () => {
      let twitterMinutes = DEFAULT_TWITTER_INTERVAL_MINUTES;
      if (twitterSelect.value === 'custom') {
        const val = parseFloat(twitterCustomInput.value);
        if (isNaN(val) || val <= 0) {
          showToast('请输入有效的 Twitter 刷新频率 (>= 1 分钟)', 'error', 2500);
          twitterCustomInput.focus();
          return;
        }
        twitterMinutes = Math.max(1, Math.round(val));
      } else {
        twitterMinutes = parseFloat(twitterSelect.value);
      }

      let discordMinutes = DEFAULT_DISCORD_INTERVAL_MINUTES;
      if (discordSelect.value === 'custom') {
        const val = parseFloat(discordCustomInput.value);
        if (isNaN(val) || val <= 0) {
          showToast('请输入有效的 Discord 刷新频率 (>= 0.5 分钟)', 'error', 2500);
          discordCustomInput.focus();
          return;
        }
        discordMinutes = Math.max(0.5, Math.round(val * 10) / 10);
      } else {
        discordMinutes = parseFloat(discordSelect.value);
      }

      const memberOnlySelect = document.getElementById('setting-show-member-only');
      let showMemberOnly = DEFAULT_SHOW_MEMBER_ONLY;
      if (memberOnlySelect) {
        showMemberOnly = memberOnlySelect.value === 'true';
      }

      const discordSoundSelect = document.getElementById('setting-discord-sound');
      let discordSoundEnabled = DEFAULT_DISCORD_SOUND_ENABLED;
      if (discordSoundSelect) {
        discordSoundEnabled = discordSoundSelect.value === 'true';
      }

      const { enabled: tickerHighlightEnabled, fg: tickerFgColor, bg: tickerBgColor } =
        getCurrentFormTickerState();

      saveTwitterIntervalMinutes(twitterMinutes);
      saveDiscordIntervalMinutes(discordMinutes);
      saveShowMemberOnlyTweets(showMemberOnly);
      saveDiscordSoundEnabled(discordSoundEnabled);
      saveTickerHighlightEnabled(tickerHighlightEnabled);
      saveTickerFgColor(tickerFgColor);
      saveTickerBgColor(tickerBgColor);
      applyTickerColors(tickerFgColor, tickerBgColor);

      if (typeof onSave === 'function') {
        onSave({
          twitterMinutes,
          discordMinutes,
          showMemberOnly,
          discordSoundEnabled,
          tickerHighlightEnabled,
          tickerFgColor,
          tickerBgColor
        });
      }

      const formatInterval = (m) => (m === 0.5 ? '30秒' : `${m}分钟`);
      const memberText = showMemberOnly ? '显示会员推文' : '隐藏会员推文';
      const tickerText = tickerHighlightEnabled ? 'Ticker高亮开启' : 'Ticker高亮关闭';
      const soundText = discordSoundEnabled ? 'Discord 提示音开启' : 'Discord 已静音';
      showToast(`设置已保存 (Twitter: ${formatInterval(twitterMinutes)}, Discord: ${formatInterval(discordMinutes)}, ${memberText}, ${tickerText}, ${soundText})`, 'success', 2500);
      closeSettingsModal();
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
  isSettingsModalOpen
};
