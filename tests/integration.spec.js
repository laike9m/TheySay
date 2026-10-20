const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_TWITTER_INTERVAL_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_HEADER_BG_COLOR_KEY
} = require('../src/constants');

test.describe.serial('TheySay Electron Integration Tests', () => {
  let electronApp;
  let page;
  let userDataDir;

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theysay-integration-'));
    fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });

    electronApp = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(__dirname, '..', 'main.js')],
      env: {
        ...process.env,
        THEYSAY_USER_DATA_DIR: userDataDir
      }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#grid-stack-container')).toBeVisible();
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (userDataDir && fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('1. App bootstrap, main process metadata & window initialization', async () => {
    const appInfo = await electronApp.evaluate(async ({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const bounds = win ? win.getBounds() : null;
      return {
        name: app.getName(),
        userData: app.getPath('userData'),
        platform: process.platform,
        windowCount: BrowserWindow.getAllWindows().length,
        isVisible: win ? win.isVisible() : false,
        bounds
      };
    });

    expect(appInfo.name).toBe('TheySay');
    expect(path.resolve(appInfo.userData)).toBe(path.resolve(userDataDir));
    expect(appInfo.windowCount).toBeGreaterThanOrEqual(1);
    expect(appInfo.bounds.width).toBeGreaterThanOrEqual(850);
    expect(appInfo.bounds.height).toBeGreaterThanOrEqual(650);

    await expect(page).toHaveTitle(/TheySay/);
    await expect(page.locator('.brand-title')).toHaveText('TheySay');
    await expect(page.locator('#btn-mark-all-read')).toBeVisible();
    await expect(page.locator('#layout-select')).toBeVisible();
    await expect(page.locator('#btn-theme-toggle')).toBeVisible();
    await expect(page.locator('#btn-settings')).toBeVisible();
    await expect(page.locator('#btn-login-menu')).toBeVisible();
  });

  test('2. Grid layout presets, slot mute toggle & slot resize menu', async () => {
    // Default preset is 2x2 (4 visible slots)
    await expect(page.locator('#layout-select')).toHaveValue('2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);

    // Switch layout preset to 3x3 (9 visible slots)
    await page.selectOption('#layout-select', '3x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(9);

    const storedPreset = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_PRESET_KEY
    );
    expect(storedPreset).toBe('3x3');

    // Switch back to 2x2
    await page.selectOption('#layout-select', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);

    // Toggle slot 0 mute button
    const muteBtn0 = page.locator('#btn-mute-0');
    await expect(muteBtn0).toHaveClass(/is-muted/);
    await muteBtn0.click();
    await expect(muteBtn0).not.toHaveClass(/is-muted/);
    await expect(muteBtn0).toHaveAttribute('aria-pressed', 'true');

    const mutedArray = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || '[]'),
      STORAGE_MUTED_SLOTS_KEY
    );
    expect(mutedArray[0]).toBe(false);

    // Clear adjacent slot 2 (row 2, col 1) so 2x1 vertical expansion on slot 0 has free space
    await page.locator('#handle-input-2').fill('');
    await page.locator('#handle-input-2').dispatchEvent('input');

    // Open slot 0 expand/size menu and resize to 2 rows x 1 col (gs-h="2")
    await page.locator('#btn-expand-0').click();
    const sizeMenu0 = page.locator('#size-menu-0');
    await expect(sizeMenu0).toBeVisible();
    await sizeMenu0.locator('.size-menu-item[data-r="2"][data-c="1"]').click();
    await expect(page.locator('.grid-stack-item[gs-id="slot-0"]')).toHaveAttribute('gs-h', '2');
    await expect(page.locator('#slot-card-0')).toHaveClass(/is-priority/);

    // Reset back to 1x1
    await page.locator('#btn-expand-0').click();
    await sizeMenu0.locator('.size-menu-item[data-r="1"][data-c="1"]').click();
    await expect(page.locator('#slot-card-0')).not.toHaveClass(/is-priority/);
  });

  test('3. Theme switching, Settings modal & Windows/macOS global Escape handling', async () => {
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    await page.locator('#btn-theme-toggle').click();
    const toggledTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    expect(toggledTheme).toBe(initialTheme === 'dark' ? 'light' : 'dark');

    // Open Settings Modal
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await expect(settingsOverlay).toHaveClass(/is-closed/);
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    // Press Escape to verify main process before-input-event -> global-escape closes modal
    await page.keyboard.press('Escape');
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    // Reopen Settings Modal, modify settings, and save
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    await page.selectOption('#setting-twitter-interval', '15');
    await page.locator('#setting-header-presets .header-preset-chip[data-bg="#2563eb"]').click();
    await page.locator('#btn-settings-save').click();
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    const savedSettings = await page.evaluate(
      ({ intervalKey, headerBgKey }) => ({
        twitterInterval: localStorage.getItem(intervalKey),
        headerBg: localStorage.getItem(headerBgKey),
        cssHeaderBg: document.documentElement.style.getPropertyValue('--slot-header-bg')
      }),
      {
        intervalKey: STORAGE_TWITTER_INTERVAL_KEY,
        headerBgKey: STORAGE_HEADER_BG_COLOR_KEY
      }
    );

    expect(savedSettings.twitterInterval).toBe('15');
    expect(savedSettings.headerBg).toBe('#2563eb');
    expect(savedSettings.cssHeaderBg).toBe('#2563eb');
  });

  test('4. Cached feed rendering, Ticker highlighting & Mark All Read', async () => {
    const nowIso = new Date().toISOString();
    await page.evaluate(
      ({ timestamp, handlesKey, cacheKey }) => {
        const handles = ['elonmusk', 'OpenAI', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'elonmusk',
            source: 'twitter',
            displayName: 'Elon Musk',
            userHandle: '@elonmusk',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            tweets: [
              {
                id: '1900000000000000001',
                text: 'Watching $NVDA and AAPL earnings closely today!',
                time: timestamp,
                url: 'https://x.com/elonmusk/status/1900000000000000001',
                isPinned: false,
                isRetweet: false,
                isUnread: true,
                images: []
              }
            ]
          }
        };
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      },
      {
        timestamp: nowIso,
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('#author-name-0')).toHaveText('Elon Musk');
    await expect(page.locator('#author-handle-0')).toHaveText('@elonmusk');
    await expect(page.locator('#slot-unread-badge-0')).toBeVisible();
    await expect(page.locator('#slot-unread-badge-0')).toContainText('1');

    // Verify tweet bubble and stock ticker highlights ($NVDA and AAPL)
    const tweetBubble = page.locator('#slot-content-0 .im-bubble').first();
    await expect(tweetBubble).toBeVisible();
    await expect(tweetBubble).toHaveClass(/unread/);

    const tickerChips = tweetBubble.locator('.ticker-highlight');
    await expect(tickerChips).toHaveCount(2);
    await expect(tickerChips.nth(0)).toHaveText('$NVDA');
    await expect(tickerChips.nth(1)).toHaveText('AAPL');

    // Click Mark All Read and verify unread state clears
    await page.locator('#btn-mark-all-read').click();
    await expect(tweetBubble).not.toHaveClass(/unread/);
    await expect(page.locator('#slot-unread-badge-0')).toBeHidden();
  });

  test('5. Profile Export & Import end-to-end via Electron IPC', async () => {
    const exportFilePath = path.join(userDataDir, 'test-profile-export.json');

    // Stub dialog.showSaveDialog and dialog.showOpenDialog in the main process
    await electronApp.evaluate(({ dialog }, targetPath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: targetPath
      });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [targetPath]
      });
    }, exportFilePath);

    // Open Login/Profile dropdown menu and trigger Export Profile
    await page.locator('#btn-login-menu').click();
    await expect(page.locator('#login-dropdown-menu')).toBeVisible();
    await page.locator('#item-export-profile').click();

    // Wait for file to be written on disk
    await expect.poll(() => fs.existsSync(exportFilePath)).toBe(true);
    const exportedJson = JSON.parse(fs.readFileSync(exportFilePath, 'utf8'));
    expect(exportedJson.app).toBe('TheySay');
    expect(exportedJson.settings.gridPreset).toBe('2x2');
    expect(exportedJson.settings.headerBgColor).toBe('#2563eb');
    expect(exportedJson.handles[0]).toBe('elonmusk');

    // Mutate current state to 3x2 layout and different theme before importing back
    await page.selectOption('#layout-select', '3x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);

    // Trigger Import Profile from Login dropdown menu
    await page.locator('#btn-login-menu').click();
    await page.locator('#item-import-profile').click();

    // Verify state is restored to exported 2x2 preset and cached tweets remain intact
    await expect(page.locator('#layout-select')).toHaveValue('2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    await expect(page.locator('#author-name-0')).toHaveText('Elon Musk');
  });

  test('6. Window state persistence (window-state.json) & screenshot capture', async () => {
    const stateFilePath = path.join(userDataDir, 'window-state.json');

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMaximized()) win.unmaximize();
        win.setSize(1240, 820);
      }
    });

    // Wait for debounced window-state.json save (150ms in main.js)
    await expect.poll(() => fs.existsSync(stateFilePath), { timeout: 5000 }).toBe(true);
    const savedState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    expect(savedState.width).toBeGreaterThanOrEqual(850);
    expect(savedState.height).toBeGreaterThanOrEqual(650);
    expect(typeof savedState.isMaximized).toBe('boolean');
    expect(typeof savedState.isFullScreen).toBe('boolean');

    // Save a visual snapshot artifact for CI inspection
    await page.screenshot({
      path: path.join(__dirname, '..', 'test-results', `dashboard-${process.platform}.png`)
    });
  });
});

