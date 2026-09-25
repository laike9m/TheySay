const { ipcRenderer } = require('electron');
const {
  DEFAULT_TWITTER_INTERVAL_MINUTES,
  DEFAULT_DISCORD_INTERVAL_MINUTES,
  DEFAULT_SHOW_MEMBER_ONLY
} = require('./constants');
const {
  getTwitterIntervalMinutes,
  saveTwitterIntervalMinutes,
  getDiscordIntervalMinutes,
  saveDiscordIntervalMinutes,
  getShowMemberOnlyTweets,
  saveShowMemberOnlyTweets
} = require('./storage');
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

      saveTwitterIntervalMinutes(twitterMinutes);
      saveDiscordIntervalMinutes(discordMinutes);
      saveShowMemberOnlyTweets(showMemberOnly);

      if (typeof onSave === 'function') {
        onSave({ twitterMinutes, discordMinutes, showMemberOnly });
      }

      const formatInterval = (m) => (m === 0.5 ? '30秒' : `${m}分钟`);
      const memberText = showMemberOnly ? '显示会员推文' : '隐藏会员推文';
      showToast(`设置已保存 (Twitter: ${formatInterval(twitterMinutes)}, Discord: ${formatInterval(discordMinutes)}, ${memberText})`, 'success', 2500);
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
