const { ipcRenderer } = require('electron');
const { MAX_SLOTS, DEFAULT_SLOT_MUTED } = require('./src/core/constants');
const {
  getStoredPreset,
  saveStoredPreset,
  getStoredTheme,
  saveGridLayout,
  saveRawGridLayout,
  saveHandlesArray,
  saveMutedSlotsArray,
  saveTwitterIntervalMinutes,
  saveThreadsIntervalMinutes,
  saveDiscordIntervalMinutes,
  saveShowMemberOnlyPosts,
  saveFilterKeywords,
  saveDiscordSoundEnabled,
  saveAppBadgeEnabled,
  saveAutoCheckUpdates,
  saveHeaderBgColor,
  saveChatBgColor,
  saveBubbleBgColor,
  saveTickerFgColor,
  saveTickerBgColor,
  getTickerFgColor,
  getTickerBgColor,
  getLanguage,
  saveLanguage,
  buildProfileData
} = require('./src/core/storage');
const {
  initTheme,
  applyTheme,
  applyHeaderColor,
  applyChatBgColor,
  applyBubbleColor
} = require('./src/ui/theme');
const { initAuth, refreshAuthLocaleUI, syncAuthStateFromCache } = require('./src/ui/auth');
const { initBackgroundWebviews } = require('./src/data/webview');
const {
  initSlotsRegistry,
  loadSlotCache,
  closeAllSizeMenus,
  updateSlotSizeUI,
  updateSlotMuteUI,
  updateAllSlotsExpiredUI,
  markAllPostsAsRead,
  refreshSlotsContent,
  localizeSlotsUI,
  archiveSlotScrapedData,
  resetSlotForNewTarget
} = require('./src/ui/slot');
const {
  calculateCellHeight,
  parsePreset,
  disableGridDomSorting,
  applyGridLayout,
  requestSlotResize,
  initColumnHoverEffect
} = require('./src/ui/grid');
const {
  fetchSlot,
  runBackgroundFetch,
  runTwitterBackgroundFetch,
  runThreadsBackgroundFetch,
  runDiscordBackgroundFetch,
  startPeriodicBackgroundFetch
} = require('./src/data/scraper');
const { initPostPopup } = require('./src/ui/popup');
const {
  initSettings,
  isSettingsModalOpen,
  loadCurrentSettings,
  getFormSettingsOverrides,
  refreshTickerStatsLabel,
  refreshUpdateStatusUI,
  startAutoUpdateCheck
} = require('./src/ui/settings');
const { applyDiscordSoundSetting } = require('./src/data/discord');
const { initNotifications } = require('./src/ui/notification');
const { initTickers, applyTickerColors } = require('./src/core/ticker');
const { getCanonicalTargetKey } = require('./src/core/source');
const { showToast } = require('./src/core/utils');
const { t, applyPageLocalization } = require('./src/core/i18n');
const { mountMantineShell } = require('./src/ui/dist/mantine-shell');

// Sync stored/default theme ('light' on first launch) before mounting Mantine outer shell
const initialTheme = getStoredTheme();
document.documentElement.setAttribute('data-theme', initialTheme);
document.documentElement.setAttribute(
  'data-mantine-color-scheme',
  initialTheme === 'dark' ? 'dark' : 'light'
);

// Mount React + Mantine outer shell synchronously before binding global UI elements
mountMantineShell();

// UI Elements - Global
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const layoutSelect = document.getElementById('layout-select');
const btnMarkAllRead = document.getElementById('btn-mark-all-read');
const gridContainer = document.getElementById('grid-stack-container');
const bgWebviewsContainer = document.getElementById('bg-webviews-container');

let grid = null;
let currentRows = 2;
let currentCols = 2;
let slots = [];

function refreshLocalizedAppUI(lang) {
  applyPageLocalization(lang);
  applyTheme(getStoredTheme(), btnThemeToggle);
  refreshAuthLocaleUI();
  refreshTickerStatsLabel();
  refreshUpdateStatusUI();
  localizeSlotsUI(slots);
  refreshSlotsContent(slots);
}

function handleFetchSlot(slotIndex, extraOptions = {}) {
  fetchSlot(slotIndex, { isBackground: false, ...extraOptions }, { slots, bgWebviewsContainer });
}

function handleSlotResize(slot, targetW, targetH) {
  requestSlotResize({
    grid,
    slot,
    targetW,
    targetH,
    currentRows,
    currentCols,
    slots
  });
}

function getGridDimensions() {
  return { rows: currentRows, cols: currentCols };
}

function getActiveSlotCount() {
  return currentRows * currentCols;
}

async function handleExportProfile(settingsOverrides = null) {
  try {
    slots.forEach(s => archiveSlotScrapedData(s));
    const overrides =
      settingsOverrides && typeof settingsOverrides === 'object'
        ? settingsOverrides
        : getFormSettingsOverrides();
    const profileData = buildProfileData({
      slots,
      grid,
      settingsOverrides: overrides
    });
    const res = await ipcRenderer.invoke('export-profile', { profileData });
    if (!res || res.canceled) return;
    if (res.ok) {
      const count = Array.isArray(profileData.following) ? profileData.following.length : 0;
      showToast(t('profile.exportSuccess', { count }), 'success', 3000);
    } else {
      showToast(
        t('profile.exportError', { error: res.error || t('profile.unknownError') }),
        'error',
        3000
      );
    }
  } catch (err) {
    showToast(t('profile.exportError', { error: err.message || err }), 'error', 3000);
  }
}

async function handleImportProfile() {
  try {
    const res = await ipcRenderer.invoke('import-profile');
    if (!res || res.canceled) return;
    if (!res.ok || !res.profileData || typeof res.profileData !== 'object') {
      showToast(
        t('profile.importError', { error: (res && res.error) || t('profile.invalidFormat') }),
        'error',
        3000
      );
      return;
    }

    const data = res.profileData;
    const settings =
      data.settings && typeof data.settings === 'object' ? data.settings : data;

    // 1. Archive all current slots' scraped data so switching profile never loses anything
    slots.forEach(s => archiveSlotScrapedData(s));

    // 2. Apply settings
    if (settings.language === 'en' || settings.language === 'zh') {
      saveLanguage(settings.language);
      if (ipcRenderer) {
        ipcRenderer.send('set-language', settings.language);
      }
      refreshLocalizedAppUI(settings.language);
    }
    if (settings.theme === 'dark' || settings.theme === 'light') {
      applyTheme(settings.theme, btnThemeToggle);
    }
    if (typeof settings.twitterIntervalMinutes === 'number' && settings.twitterIntervalMinutes > 0) {
      saveTwitterIntervalMinutes(settings.twitterIntervalMinutes);
    }
    if (typeof settings.threadsIntervalMinutes === 'number' && settings.threadsIntervalMinutes > 0) {
      saveThreadsIntervalMinutes(settings.threadsIntervalMinutes);
    }
    if (typeof settings.discordIntervalMinutes === 'number' && settings.discordIntervalMinutes > 0) {
      saveDiscordIntervalMinutes(settings.discordIntervalMinutes);
    }
    if (typeof settings.showMemberOnlyPosts === 'boolean') {
      saveShowMemberOnlyPosts(settings.showMemberOnlyPosts);
    } else if (typeof settings.showMemberOnlyTweets === 'boolean') {
      saveShowMemberOnlyPosts(settings.showMemberOnlyTweets);
    }
    if (settings.filterKeywords !== undefined) {
      saveFilterKeywords(settings.filterKeywords);
    }
    if (typeof settings.discordSoundEnabled === 'boolean') {
      saveDiscordSoundEnabled(settings.discordSoundEnabled);
    }
    if (typeof settings.appBadgeEnabled === 'boolean') {
      saveAppBadgeEnabled(settings.appBadgeEnabled);
    }
    if (typeof settings.autoCheckUpdates === 'boolean') {
      saveAutoCheckUpdates(settings.autoCheckUpdates);
    }
    if (typeof settings.headerBgColor === 'string' && settings.headerBgColor.trim()) {
      saveHeaderBgColor(settings.headerBgColor.trim());
      applyHeaderColor(settings.headerBgColor.trim());
    }
    if (typeof settings.chatBgColor === 'string' && settings.chatBgColor.trim()) {
      saveChatBgColor(settings.chatBgColor.trim());
      applyChatBgColor(settings.chatBgColor.trim());
    }
    if (typeof settings.bubbleBgColor === 'string' && settings.bubbleBgColor.trim()) {
      saveBubbleBgColor(settings.bubbleBgColor.trim());
      applyBubbleColor(settings.bubbleBgColor.trim());
    }
    // (legacy profiles may contain `tickerHighlightEnabled`; highlighting is always on now, so it is ignored)
    if (typeof settings.tickerFgColor === 'string' && settings.tickerFgColor.trim()) {
      saveTickerFgColor(settings.tickerFgColor.trim());
    }
    if (typeof settings.tickerBgColor === 'string' && settings.tickerBgColor.trim()) {
      saveTickerBgColor(settings.tickerBgColor.trim());
    }
    applyTickerColors(getTickerFgColor(), getTickerBgColor());

    // 3. Extract followed accounts & per-slot mute state
    const nextHandles = new Array(MAX_SLOTS).fill('');
    const nextMuted = new Array(MAX_SLOTS).fill(DEFAULT_SLOT_MUTED);
    let hasImportedHandles = false;

    if (Array.isArray(settings.mutedSlots)) {
      for (let i = 0; i < MAX_SLOTS; i++) {
        if (typeof settings.mutedSlots[i] === 'boolean') {
          nextMuted[i] = settings.mutedSlots[i];
        }
      }
    }

    if (Array.isArray(data.handles)) {
      hasImportedHandles = true;
      for (let i = 0; i < Math.min(MAX_SLOTS, data.handles.length); i++) {
        nextHandles[i] = String(data.handles[i] || '').trim();
      }
    }

    const slotEntries = Array.isArray(data.slots)
      ? data.slots
      : Array.isArray(data.following)
        ? data.following
        : null;

    if (Array.isArray(slotEntries)) {
      hasImportedHandles = true;
      slotEntries.forEach((item, idx) => {
        if (!item) return;
        if (typeof item === 'string') {
          if (idx < MAX_SLOTS && !nextHandles[idx]) {
            nextHandles[idx] = item.trim();
          }
          return;
        }
        const targetIdx =
          Number.isInteger(item.slotIndex) && item.slotIndex >= 0 && item.slotIndex < MAX_SLOTS
            ? item.slotIndex
            : idx < MAX_SLOTS
              ? idx
              : -1;
        if (targetIdx >= 0) {
          const rawVal = String(item.input || item.handle || '').trim();
          if (rawVal || !Array.isArray(data.handles)) {
            nextHandles[targetIdx] = rawVal;
          }
          if (typeof item.isMuted === 'boolean' && !Array.isArray(settings.mutedSlots)) {
            nextMuted[targetIdx] = item.isMuted;
          }
        }
      });
    }

    saveMutedSlotsArray(nextMuted);
    slots.forEach((slot, i) => {
      slot.isMuted = nextMuted[i];
      updateSlotMuteUI(slot);
    });

    if (hasImportedHandles) {
      saveHandlesArray(nextHandles);
      slots.forEach((slot, i) => {
        const nextVal = nextHandles[i] || '';
        const prevInput = slot.monitoredHandle || (slot.handleInput ? slot.handleInput.value.trim() : '');
        const prevKey = getCanonicalTargetKey(prevInput, slot.source);
        const nextKey = getCanonicalTargetKey(nextVal);
        if (prevKey !== nextKey) {
          resetSlotForNewTarget(slot, nextVal, slots);
        } else if (slot.handleInput) {
          slot.handleInput.value = nextVal;
          if (slot.btnClear) {
            slot.btnClear.style.display = nextVal.length > 0 ? 'flex' : 'none';
          }
        }
      });
      // Restore cached data for all handles/channels from target cache archive
      loadSlotCache(slots);
      syncAuthStateFromCache(slots);
    }

    // 4. Apply grid preset and saved layout positions/sizes
    let importedLayout = Array.isArray(settings.gridLayout) ? settings.gridLayout : null;
    if (!importedLayout && Array.isArray(data.slots)) {
      const derived = data.slots
        .filter(s => s && Number.isInteger(s.slotIndex) && (s.w || s.h))
        .map(s => ({
          id: `slot-${s.slotIndex}`,
          slotIndex: s.slotIndex,
          x: Number.isInteger(s.x) ? s.x : undefined,
          y: Number.isInteger(s.y) ? s.y : undefined,
          w: s.w || 1,
          h: s.h || 1
        }));
      if (derived.length > 0) importedLayout = derived;
    }
    if (importedLayout) {
      saveRawGridLayout(importedLayout);
    }

    const nextPreset =
      typeof settings.gridPreset === 'string' && /^\d+x\d+$/.test(settings.gridPreset)
        ? settings.gridPreset
        : getStoredPreset();
    saveStoredPreset(nextPreset);
    if (layoutSelect) layoutSelect.value = nextPreset;
    const { rows: nextRows, cols: nextCols } = parsePreset(nextPreset);
    currentRows = nextRows;
    currentCols = nextCols;

    if (grid) {
      applyGridLayout({
        grid,
        gridContainer,
        slots,
        rows: nextRows,
        cols: nextCols,
        resetPositions: !importedLayout,
        maxSlots: MAX_SLOTS
      });
    }

    // 5. Refresh UI, timers, and settings modal if open
    refreshSlotsContent(slots);
    applyDiscordSoundSetting();
    startPeriodicBackgroundFetch({
      slots,
      bgWebviewsContainer,
      getActiveSlotCount
    });
    if (isSettingsModalOpen()) {
      loadCurrentSettings();
    }

    // Trigger background fetch for any active slot that has a handle/channel but no cached data yet
    const activeSlots = slots.slice(0, getActiveSlotCount());
    const hasUncachedTwitter = activeSlots.some(
      s => s && s.handleInput && s.handleInput.value.trim() && s.source !== 'discord' && s.source !== 'threads' && (!s.loadedPosts || s.loadedPosts.length === 0)
    );
    const hasUncachedThreads = activeSlots.some(
      s => s && s.handleInput && s.handleInput.value.trim() && s.source === 'threads' && (!s.loadedPosts || s.loadedPosts.length === 0)
    );
    const hasUncachedDiscord = activeSlots.some(
      s => s && s.handleInput && s.handleInput.value.trim() && s.source === 'discord' && (!s.loadedPosts || s.loadedPosts.length === 0)
    );
    if (hasUncachedTwitter) {
      setTimeout(() => {
        runBackgroundFetch({ slots, bgWebviewsContainer, getActiveSlotCount });
      }, 600);
    }
    if (hasUncachedThreads) {
      setTimeout(() => {
        runThreadsBackgroundFetch({ slots, bgWebviewsContainer, getActiveSlotCount });
      }, 700);
    }
    if (hasUncachedDiscord) {
      setTimeout(() => {
        runDiscordBackgroundFetch({ slots, bgWebviewsContainer, getActiveSlotCount });
      }, 800);
    }

    const followedCount = nextHandles.filter(Boolean).length;
    showToast(
      t('profile.importSuccess', { count: followedCount }),
      'success',
      3200
    );
  } catch (err) {
    showToast(t('profile.importError', { error: err.message || err }), 'error', 3000);
  }
}

// ----------------------------------------------------
// Lifecycle Initialization & Window Resize
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  const initialLang = getLanguage();
  applyPageLocalization(initialLang);
  if (ipcRenderer) {
    ipcRenderer.send('set-language', { lang: initialLang, persist: false });
  }

  initTheme(btnThemeToggle);
  initPostPopup();
  initBackgroundWebviews(bgWebviewsContainer, slots, MAX_SLOTS);

  slots = initSlotsRegistry({
    slotsCount: MAX_SLOTS,
    bgWebviewsContainer,
    onFetch: handleFetchSlot,
    onResize: handleSlotResize,
    getGridDimensions
  });

  initTickers({
    onUpdated: () => refreshSlotsContent(slots)
  });
  initNotifications(slots);
  initAuth({
    onExportProfile: () => handleExportProfile(),
    onImportProfile: () => handleImportProfile(),
    onExpiredStateChange: () => {
      updateAllSlotsExpiredUI(slots);
      if (grid) {
        grid.cellHeight(calculateCellHeight(currentRows));
      }
    },
    onLoginSuccess: (platform) => {
      updateAllSlotsExpiredUI(slots);
      if (grid) {
        grid.cellHeight(calculateCellHeight(currentRows));
      }
      const ctx = { slots, bgWebviewsContainer, getActiveSlotCount };
      if (platform === 'discord') {
        setTimeout(() => runDiscordBackgroundFetch(ctx), 300);
      } else if (platform === 'threads') {
        setTimeout(() => runThreadsBackgroundFetch(ctx), 300);
      } else if (platform === 'twitter') {
        setTimeout(() => runTwitterBackgroundFetch(ctx), 300);
      }
    }
  });
  initSettings({
    onExportProfile: (overrides) => handleExportProfile(overrides),
    onImportProfile: () => handleImportProfile(),
    onLanguageChange: (lang) => refreshLocalizedAppUI(lang),
    onSave: (opts = {}) => {
      if (opts && opts.syncedTickersOnly) {
        refreshSlotsContent(slots);
        return;
      }
      startPeriodicBackgroundFetch({
        slots,
        bgWebviewsContainer,
        getActiveSlotCount
      });
      refreshSlotsContent(slots);
      applyDiscordSoundSetting();
    }
  });

  // Close size menus when clicking outside
  document.addEventListener('click', () => closeAllSizeMenus(slots));

  // Initialize GridStack
  const savedPreset = getStoredPreset();
  if (layoutSelect) layoutSelect.value = savedPreset;
  const { rows, cols } = parsePreset(savedPreset);
  currentRows = rows;
  currentCols = cols;

  grid = GridStack.init({
    column: cols,
    cellHeight: calculateCellHeight(rows),
    margin: '3px 2px',
    animate: true,
    float: false,
    handle: '.slot-drag-handle',
    resizable: {
      handles: 'e,se,s,sw,w'
    }
  });
  // Keep slot feeds' scroll positions intact across drag/resize (see grid.js)
  disableGridDomSorting(grid);

  // Apply layout
  applyGridLayout({
    grid,
    gridContainer,
    slots,
    rows,
    cols,
    resetPositions: false,
    maxSlots: MAX_SLOTS
  });

  // Initialize smooth column section hover expand/squeeze effect
  initColumnHoverEffect({
    gridContainer,
    slots,
    getGrid: () => grid,
    getGridDimensions
  });

  // Restore cached posts and synchronize login expiration state
  loadSlotCache(slots);
  syncAuthStateFromCache(slots);

  // If any active Twitter or Discord slot has legacy cached messages from before image URL extraction,
  // automatically refresh in the background once to populate inline image thumbnails.
  const hasLegacyTwitterCache = slots.slice(0, getActiveSlotCount()).some(
    s => s && s.source !== 'discord' && s.source !== 'threads' && Array.isArray(s.loadedPosts) && s.loadedPosts.some(m => !Array.isArray(m.images))
  );
  if (hasLegacyTwitterCache) {
    setTimeout(() => {
      runBackgroundFetch({
        slots,
        bgWebviewsContainer,
        getActiveSlotCount
      });
    }, 900);
  }

  const hasLegacyDiscordCache = slots.slice(0, getActiveSlotCount()).some(
    s => s && s.source === 'discord' && Array.isArray(s.loadedPosts) && s.loadedPosts.some(m => !Array.isArray(m.images))
  );
  if (hasLegacyDiscordCache) {
    setTimeout(() => {
      runDiscordBackgroundFetch({
        slots,
        bgWebviewsContainer,
        getActiveSlotCount
      });
    }, 1200);
  }

  // Save on layout changes (drag, resize) & synchronize size UI
  grid.on('change', (event, items) => {
    if (Array.isArray(items)) {
      items.forEach(item => {
        const idx = parseInt(item.el.getAttribute('data-slot-index'), 10);
        if (!isNaN(idx) && slots[idx]) {
          updateSlotSizeUI(slots[idx], item.w || 1, item.h || 1);
        }
      });
    }
    saveGridLayout(grid);
  });

  // Layout preset dropdown change
  if (layoutSelect) {
    layoutSelect.addEventListener('change', () => {
      const val = layoutSelect.value;
      saveStoredPreset(val);
      const { rows: nextRows, cols: nextCols } = parsePreset(val);
      currentRows = nextRows;
      currentCols = nextCols;
      applyGridLayout({
        grid,
        gridContainer,
        slots,
        rows: nextRows,
        cols: nextCols,
        resetPositions: true,
        maxSlots: MAX_SLOTS
      });
    });
  }

  // Mark all posts as read button
  if (btnMarkAllRead) {
    btnMarkAllRead.addEventListener('click', () => markAllPostsAsRead(slots));
  }

  // Responsive dynamic cellHeight on window resize
  window.addEventListener('resize', () => {
    if (grid) {
      grid.cellHeight(calculateCellHeight(currentRows));
    }
  });

  // Start periodic 10-minute background fetch
  startPeriodicBackgroundFetch({
    slots,
    bgWebviewsContainer,
    getActiveSlotCount
  });

  // Start automatic GitHub Releases version check
  startAutoUpdateCheck();
});
