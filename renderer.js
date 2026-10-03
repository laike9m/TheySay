const { MAX_SLOTS } = require('./src/constants');
const { getStoredPreset, saveStoredPreset, saveGridLayout } = require('./src/storage');
const { initTheme } = require('./src/theme');
const { initAuth } = require('./src/auth');
const { initBackgroundWebviews } = require('./src/webview');
const {
  initSlotsRegistry,
  loadSlotCache,
  closeAllSizeMenus,
  updateSlotSizeUI,
  markAllTweetsAsRead,
  refreshSlotsContent
} = require('./src/slot');
const {
  calculateCellHeight,
  parsePreset,
  applyGridLayout,
  requestSlotResize
} = require('./src/grid');
const {
  fetchSlot,
  runDiscordBackgroundFetch,
  startPeriodicBackgroundFetch
} = require('./src/scraper');
const { initTweetPopup } = require('./src/popup');
const { initSettings } = require('./src/settings');
const { applyDiscordSoundSetting } = require('./src/discord');

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

function handleFetchSlot(slotIndex) {
  fetchSlot(slotIndex, { isBackground: false }, { slots, bgWebviewsContainer });
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

// ----------------------------------------------------
// Lifecycle Initialization & Window Resize
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initTheme(btnThemeToggle);
  initTweetPopup();
  initBackgroundWebviews(bgWebviewsContainer, slots, MAX_SLOTS);

  slots = initSlotsRegistry({
    slotsCount: MAX_SLOTS,
    bgWebviewsContainer,
    onFetch: handleFetchSlot,
    onResize: handleSlotResize,
    getGridDimensions
  });

  initAuth();
  initSettings({
    onSave: () => {
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
    margin: 8,
    animate: true,
    float: false,
    handle: '.slot-drag-handle',
    resizable: {
      handles: 'e,se,s,sw,w'
    }
  });

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

  // Restore cached tweets
  loadSlotCache(slots);

  // If any active Discord slot has legacy cached messages from before image URL extraction,
  // automatically refresh Discord in the background once to populate inline images.
  const hasLegacyDiscordCache = slots.slice(0, getActiveSlotCount()).some(
    s => s && s.source === 'discord' && Array.isArray(s.loadedTweets) && s.loadedTweets.some(m => !Array.isArray(m.images))
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

  // Mark all tweets as read button
  if (btnMarkAllRead) {
    btnMarkAllRead.addEventListener('click', () => markAllTweetsAsRead(slots));
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
});
