const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  STORAGE_HANDLES_KEY,
  STORAGE_CACHE_KEY,
  STORAGE_PRESET_KEY,
  STORAGE_TWITTER_INTERVAL_KEY,
  STORAGE_THREADS_INTERVAL_KEY,
  STORAGE_MUTED_SLOTS_KEY,
  STORAGE_HEADER_BG_COLOR_KEY,
  STORAGE_LANGUAGE_KEY
} = require('../src/core/constants');
const { isChineseLocale, resolveLanguageCode } = require('../src/core/i18n');

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
        THEYSAY_USER_DATA_DIR: userDataDir,
        THEYSAY_BACKGROUND_TEST: '1'
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
        dockVisible: process.platform === 'darwin' && app.dock ? app.dock.isVisible() : null,
        bounds
      };
    });

    expect(appInfo.name).toBe('TheySay');
    expect(path.resolve(appInfo.userData)).toBe(path.resolve(userDataDir));
    expect(appInfo.windowCount).toBeGreaterThanOrEqual(1);
    expect(appInfo.bounds.width).toBeGreaterThanOrEqual(850);
    expect(appInfo.bounds.height).toBeGreaterThanOrEqual(650);
    if (process.platform === 'darwin') {
      expect(appInfo.isVisible).toBe(false);
      expect(appInfo.dockVisible).toBe(false);
    }

    await expect(page).toHaveTitle(/TheySay/);
    await expect(page.locator('.brand-title')).toHaveText('TheySay');
    await expect(page.locator('header.top-nav')).toHaveClass(/mantine-Paper-root/);
    await expect(page.locator('header.top-nav')).toHaveClass(/mantine-side-nav/);
    await expect(page.locator('header.top-nav')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#btn-sidebar-toggle')).toBeVisible();
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('header.top-nav')).toHaveClass(/is-expanded/);
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('header.top-nav')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#btn-mark-all-read')).toBeVisible();
    await expect(page.locator('#btn-mark-all-read')).toHaveClass(/mantine-Button-root/);
    await expect(page.locator('#layout-select')).toBeVisible();
    await expect(page.locator('#layout-select')).toHaveClass(/mantine-NativeSelect-input/);
    await expect(page.locator('#btn-theme-toggle')).toBeVisible();
    await expect(page.locator('#btn-settings')).toBeVisible();
    await expect(page.locator('#btn-settings')).toHaveClass(/mantine-ActionIcon-root/);
    await expect(page.locator('#btn-login-menu')).toBeVisible();
    await expect(page.locator('#btn-login-menu')).toHaveClass(/mantine-Button-root/);
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
    await expect(page.locator('#slot-card-0')).toHaveClass(/mantine-Paper-root/);
    const muteBtn0 = page.locator('#btn-mute-0');
    await expect(muteBtn0).toHaveClass(/mantine-ActionIcon-root/);
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
    await expect(page.locator('#btn-expand-0')).toHaveClass(/mantine-ActionIcon-root/);
    await page.locator('#btn-expand-0').click();
    const sizeMenu0 = page.locator('#size-menu-0');
    await expect(sizeMenu0).toBeVisible();
    await expect(sizeMenu0).toHaveClass(/mantine-Paper-root/);
    await expect(sizeMenu0.locator('.size-menu-item[data-r="2"][data-c="1"]')).toHaveClass(
      /mantine-UnstyledButton-root/
    );
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
    const toggledTheme = await page.evaluate(() => ({
      dataTheme: document.documentElement.getAttribute('data-theme'),
      mantineScheme: document.documentElement.getAttribute('data-mantine-color-scheme')
    }));
    const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark';
    expect(toggledTheme.dataTheme).toBe(expectedTheme);
    expect(toggledTheme.mantineScheme).toBe(expectedTheme);

    // Open Settings Modal
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await expect(settingsOverlay).toHaveClass(/is-closed/);
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);
    await expect(settingsOverlay.locator('.settings-modal-dialog')).toHaveClass(/mantine-Paper-root/);

    // Press Escape to verify main process before-input-event -> global-escape closes modal
    await page.keyboard.press('Escape');
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    // Reopen Settings Modal, modify settings (auto-saved immediately), and close
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    await expect(page.locator('#setting-twitter-interval')).toHaveClass(/mantine-NativeSelect-input/);
    await page.selectOption('#setting-twitter-interval', '15');
    const bluePresetChip = page.locator('#setting-header-presets .header-preset-chip[data-bg="#2563eb"]');
    await expect(bluePresetChip).toHaveClass(/mantine-ColorSwatch-root/);
    await bluePresetChip.click();
    await page.locator('#btn-settings-close').click();
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
            posts: [
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
    await expect(page.locator('#slot-unread-badge-0')).toHaveClass(/mantine-Badge-root/);
    await expect(page.locator('#slot-unread-badge-0')).toContainText('1');

    await page.evaluate(async () => {
      if (navigator.setAppBadge) {
        await navigator.setAppBadge(99);
      }
    });

    const unreadAppBadge = await page.evaluate(() =>
      require('electron').ipcRenderer.invoke('get-app-badge-count')
    );
    expect(unreadAppBadge).toBe(1);

    // Toggle App Icon Badge setting off and verify OS app badge clears while slot unread badge remains
    const settingsOverlay = page.locator('#settings-modal-overlay');
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);
    await expect(page.locator('#setting-app-badge')).toHaveValue('true');
    await page.selectOption('#setting-app-badge', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => require('electron').ipcRenderer.invoke('get-app-badge-count'))
      )
      .toBe(0);
    await expect(page.locator('#slot-unread-badge-0')).toBeVisible();

    // Toggle App Icon Badge setting back on and verify OS app badge restores to 1
    await page.selectOption('#setting-app-badge', 'true');
    await expect
      .poll(() =>
        page.evaluate(() => require('electron').ipcRenderer.invoke('get-app-badge-count'))
      )
      .toBe(1);
    await page.locator('#btn-settings-close').click();
    await expect(settingsOverlay).toHaveClass(/is-closed/);

    // Verify post bubble and stock ticker highlights ($NVDA and AAPL)
    await expect(page.locator('#slot-content-0 .im-date-pill').first()).toHaveClass(
      /mantine-Badge-root/
    );
    const postBubble = page.locator('#slot-content-0 .im-bubble').first();
    await expect(postBubble).toBeVisible();
    await expect(postBubble).toHaveClass(/mantine-Paper-root/);
    await expect(postBubble).toHaveClass(/unread/);

    const tickerChips = postBubble.locator('.ticker-highlight');
    await expect(tickerChips).toHaveCount(2);
    await expect(tickerChips.nth(0)).toHaveText('$NVDA');
    await expect(tickerChips.nth(1)).toHaveText('AAPL');

    // Click Mark All Read and verify unread state clears
    await page.locator('#btn-mark-all-read').click();
    await expect(postBubble).not.toHaveClass(/unread/);
    await expect(page.locator('#slot-unread-badge-0')).toBeHidden();

    const clearedAppBadge = await page.evaluate(() =>
      require('electron').ipcRenderer.invoke('get-app-badge-count')
    );
    expect(clearedAppBadge).toBe(0);
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
    await expect(page.locator('#login-dropdown-menu')).toHaveClass(/mantine-Paper-root/);
    await page.locator('#item-export-profile').click();

    // Wait for file to be written on disk and Mantine Notification toast to appear
    await expect.poll(() => fs.existsSync(exportFilePath)).toBe(true);
    await expect(page.locator('.mantine-Notification-root.mantine-toast-item').first()).toBeVisible();
    const exportedJson = JSON.parse(fs.readFileSync(exportFilePath, 'utf8'));
    expect(exportedJson.app).toBe('TheySay');
    expect(exportedJson.settings.gridPreset).toBe('2x2');
    expect(exportedJson.settings.headerBgColor).toBe('#2563eb');
    expect(exportedJson.settings.appBadgeEnabled).toBe(true);
    expect(exportedJson.handles[0]).toBe('elonmusk');

    // Mutate current state to 3x2 layout and different theme before importing back
    await page.selectOption('#layout-select', '3x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(6);

    // Trigger Import Profile from Login dropdown menu
    await page.locator('#btn-login-menu').click();
    await page.locator('#item-import-profile').click();

    // Verify state is restored to exported 2x2 preset and cached posts remain intact
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

  test('7. Localization: system language detection (English default vs Chinese variants) & live switching', async () => {
    // Unit-level verification of locale detection rules:
    // Default to English unless system language is Chinese (Simplified, Traditional, HK, TW, Hans, Hant, etc.)
    expect(isChineseLocale('en-US')).toBe(false);
    expect(isChineseLocale('en-GB')).toBe(false);
    expect(isChineseLocale('ja-JP')).toBe(false);
    expect(isChineseLocale('fr-FR')).toBe(false);
    expect(resolveLanguageCode('en-US')).toBe('en');
    expect(resolveLanguageCode('ja-JP')).toBe('en');

    expect(isChineseLocale('zh')).toBe(true);
    expect(isChineseLocale('zh-CN')).toBe(true);
    expect(isChineseLocale('zh-TW')).toBe(true);
    expect(isChineseLocale('zh-HK')).toBe(true);
    expect(isChineseLocale('zh-Hant-HK')).toBe(true);
    expect(isChineseLocale('zh-Hans-CN')).toBe(true);
    expect(resolveLanguageCode('zh-CN')).toBe('zh');
    expect(resolveLanguageCode('zh-TW')).toBe('zh');
    expect(resolveLanguageCode('zh-Hant')).toBe('zh');

    // Verify detectSystemLanguage() inside the renderer with simulated system locales
    const detectedLocales = await page.evaluate(() => {
      const { detectSystemLanguage } = require('./src/core/i18n');
      const prev = window.__THEYSAY_SYSTEM_LOCALE;
      const results = {};
      for (const loc of ['en-US', 'fr-FR', 'ja-JP', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hant']) {
        window.__THEYSAY_SYSTEM_LOCALE = loc;
        results[loc] = detectSystemLanguage();
      }
      if (prev === undefined) {
        delete window.__THEYSAY_SYSTEM_LOCALE;
      } else {
        window.__THEYSAY_SYSTEM_LOCALE = prev;
      }
      return results;
    });
    expect(detectedLocales['en-US']).toBe('en');
    expect(detectedLocales['fr-FR']).toBe('en');
    expect(detectedLocales['ja-JP']).toBe('en');
    expect(detectedLocales['zh-CN']).toBe('zh');
    expect(detectedLocales['zh-TW']).toBe('zh');
    expect(detectedLocales['zh-HK']).toBe('zh');
    expect(detectedLocales['zh-Hant']).toBe('zh');

    // Open Settings and switch to English ('en')
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-modal-overlay')).not.toHaveClass(/is-closed/);
    await page.selectOption('#setting-language', 'en');

    // Live preview updates UI to English immediately
    await expect(page.locator('#btn-mark-all-read [data-i18n="nav.markAllRead"]')).toHaveText(
      'Mark All Read'
    );
    await expect(page.locator('#settings-dialog-title')).toHaveText('Preferences');
    await expect(page.locator('#handle-input-1')).toHaveAttribute(
      'placeholder',
      'Twitter / Threads handle or Discord URL'
    );

    // Ensure no settings card title or subtitle is clipped/overflowing in English
    const overflowCount = await page.evaluate(() => {
      const els = document.querySelectorAll(
        '#settings-modal-overlay .settings-row-title, #settings-modal-overlay .settings-row-subtitle'
      );
      let clipped = 0;
      els.forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) {
          clipped++;
        }
      });
      return clipped;
    });
    expect(overflowCount).toBe(0);

    // Verify English setting auto-saved immediately
    await page.locator('#btn-settings-close').click();
    await expect(page.locator('#settings-modal-overlay')).toHaveClass(/is-closed/);
    const savedLangEn = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_LANGUAGE_KEY
    );
    expect(savedLangEn).toBe('en');
    await expect(page).toHaveTitle('TheySay - Twitter / X, Threads & Discord Grid Dashboard');

    // Switch to Chinese ('zh') and verify UI updates to Chinese & persists to disk immediately
    const prefFilePath = path.join(userDataDir, 'preferences.json');
    await page.locator('#btn-settings').click();
    await page.selectOption('#setting-language', 'zh');
    await expect(page.locator('#btn-mark-all-read [data-i18n="nav.markAllRead"]')).toHaveText(
      '全部已读'
    );
    await expect(page.locator('#settings-dialog-title')).toHaveText('偏好设置');
    await expect(page.locator('#handle-input-1')).toHaveAttribute(
      'placeholder',
      'Twitter / Threads 用户名 或 Discord 频道链接'
    );
    await expect.poll(() => {
      if (!fs.existsSync(prefFilePath)) return null;
      return JSON.parse(fs.readFileSync(prefFilePath, 'utf8')).language;
    }, { timeout: 3000 }).toBe('zh');

    await page.locator('#btn-settings-close').click();
    const savedLangZh = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_LANGUAGE_KEY
    );
    expect(savedLangZh).toBe('zh');
    await expect(page).toHaveTitle('TheySay - Twitter / X, Threads & Discord 动态网格看板');
  });

  test('8. Dragging a slot keeps every feed\'s scroll position', async () => {
    // Seed four slots with long feeds so each content container is scrollable
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const handles = ['elonmusk', 'OpenAI', 'nasa', 'github'];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const feed = (handle, name) => ({
          handle,
          source: 'twitter',
          displayName: name,
          userHandle: `@${handle}`,
          avatarUrl: '',
          lastFetchedAt: Date.now(),
          posts: Array.from({ length: 40 }, (_, i) => {
            const id = `19000000000000${String(i).padStart(5, '0')}`;
            return {
              id,
              text: `${name} message #${i} — lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
              time: new Date(Date.now() - (40 - i) * 3600e3).toISOString(),
              url: `https://x.com/${handle}/status/${id}`,
              isPinned: false,
              isRetweet: false,
              isUnread: false,
              images: []
            };
          })
        });
        localStorage.setItem(cacheKey, JSON.stringify({
          0: feed('elonmusk', 'Elon'),
          1: feed('OpenAI', 'OpenAI'),
          2: feed('nasa', 'NASA'),
          3: feed('github', 'GitHub')
        }));
      },
      { handlesKey: STORAGE_HANDLES_KEY, cacheKey: STORAGE_CACHE_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#slot-content-3 .im-bubble').first()).toBeVisible();

    // Slot 0 stays at the bottom (default); scroll slots 1-3 to mid-feed so that both a
    // "reset to top" and a "snap to bottom" regression would be detectable.
    const before = await page.evaluate(() => [0, 1, 2, 3].map((i) => {
      const c = document.getElementById(`slot-content-${i}`);
      if (i > 0) c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) / 2);
      return c.scrollTop;
    }));
    expect(before[0]).toBeGreaterThan(0);
    expect(before[1]).toBeGreaterThan(0);

    // Drag slot 0 by its header onto slot 1's cell (real mouse events through GridStack DD)
    const handle0 = await page.locator('.grid-stack-item[gs-id="slot-0"] .slot-drag-handle').boundingBox();
    const target = await page.locator('.grid-stack-item[gs-id="slot-1"]').boundingBox();
    const startX = handle0.x + handle0.width / 2;
    const startY = handle0.y + handle0.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 15, startY + 5, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + 20, { steps: 12 });
    await page.waitForTimeout(400);
    await page.mouse.up();

    // Layout swapped...
    await expect(page.locator('.grid-stack-item[gs-id="slot-0"]')).toHaveAttribute('gs-x', '1');
    await expect(page.locator('.grid-stack-item[gs-id="slot-1"]')).toHaveAttribute('gs-x', '0');
    await page.waitForTimeout(500);

    // ...but no feed moved.
    const after = await page.evaluate(() =>
      [0, 1, 2, 3].map((i) => document.getElementById(`slot-content-${i}`).scrollTop)
    );
    expect(after).toEqual(before);
  });

  test('9. Section drag-and-drop & resize layout persistence across app close and reopen', async () => {
    const readGridPositions = async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('#grid-stack-container > .grid-stack-item'))
          .map((el) => ({
            slotIndex: parseInt(el.getAttribute('data-slot-index'), 10),
            x: el.gridstackNode.x,
            y: el.gridstackNode.y,
            w: el.gridstackNode.w,
            h: el.gridstackNode.h
          }))
          .sort((a, b) => a.slotIndex - b.slotIndex)
      );

    // 1. Switch to 3x3 preset and drag slot-0 (top-left, y=0) down to bottom-left (y=2),
    // swapping with slot-6 (originally y=2) — previously reverted on restart due to out-of-order packing
    await page.selectOption('#layout-select', '3x3');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(9);
    await page.waitForTimeout(350);

    const handle0 = page.locator('.grid-stack-item[data-slot-index="0"] .slot-drag-handle');
    const slot6 = page.locator('.grid-stack-item[data-slot-index="6"]');
    const box0 = await handle0.boundingBox();
    const box6 = await slot6.boundingBox();

    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2 + 12, { steps: 3 });
    await page.mouse.move(box6.x + box6.width / 2, box6.y + box6.height / 2, { steps: 15 });
    await page.waitForTimeout(300);
    await page.mouse.up();

    const posAfter3x3Drag = await readGridPositions();
    // Verify slot-0 moved away from (0, 0) to row 2
    expect(posAfter3x3Drag.find((p) => p.slotIndex === 0).y).toBe(2);

    // Reload and verify 3x3 dragged layout is preserved
    await page.reload({ waitUntil: 'domcontentloaded' });
    const posAfter3x3Reload = await readGridPositions();
    expect(posAfter3x3Reload).toEqual(posAfter3x3Drag);

    // 2. Switch to 2x2, perform a diagonal drag (slot-0 onto slot-3) AND close + reopen the Electron app
    await page.selectOption('#layout-select', '2x2');
    await expect(page.locator('#grid-stack-container > .grid-stack-item')).toHaveCount(4);
    await page.waitForTimeout(350);

    const h0 = page.locator('.grid-stack-item[data-slot-index="0"] .slot-drag-handle');
    const s3 = page.locator('.grid-stack-item[data-slot-index="3"]');
    const b0 = await h0.boundingBox();
    const b3 = await s3.boundingBox();

    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 12, b0.y + b0.height / 2 + 12, { steps: 3 });
    await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2, { steps: 15 });
    await page.waitForTimeout(300);
    await page.mouse.up();

    const posBeforeRestart = await readGridPositions();
    expect(posBeforeRestart.find((p) => p.slotIndex === 0)).toMatchObject({ x: 1, y: 1 });

    // Close the Electron app completely and relaunch with the same userDataDir
    await electronApp.close();
    electronApp = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(__dirname, '..', 'main.js')],
      env: {
        ...process.env,
        THEYSAY_USER_DATA_DIR: userDataDir,
        THEYSAY_BACKGROUND_TEST: '1'
      }
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#grid-stack-container')).toBeVisible();

    const posAfterRestart = await readGridPositions();
    expect(posAfterRestart).toEqual(posBeforeRestart);
  });

  test('10. Threads data source detection, cached feed rendering, Threads popup modal & settings', async () => {
    // 1. Verify source detection & canonical target key resolution for Threads URLs/shorthands
    const sourceParsing = await page.evaluate(() => {
      const {
        detectSourceType,
        parseThreadsInput,
        buildThreadsProfileUrl,
        getCanonicalTargetKey
      } = require('./src/core/source');
      return {
        comUrl: detectSourceType('https://www.threads.com/@zuck'),
        netUrl: detectSourceType('https://www.threads.net/@mosseri/post/DVZ8a9bXk12'),
        shorthand: detectSourceType('threads:@zuck'),
        slashForm: detectSourceType('threads/zuck'),
        parsedHandle: parseThreadsInput('https://www.threads.com/@Zuck/post/DVZ8a9bXk12')?.handle,
        profileUrl: buildThreadsProfileUrl('threads:@zuck'),
        canonicalCom: getCanonicalTargetKey('https://www.threads.com/@Zuck'),
        canonicalShort: getCanonicalTargetKey('threads:zuck')
      };
    });

    expect(sourceParsing.comUrl).toBe('threads');
    expect(sourceParsing.netUrl).toBe('threads');
    expect(sourceParsing.shorthand).toBe('threads');
    expect(sourceParsing.slashForm).toBe('threads');
    expect(sourceParsing.parsedHandle).toBe('zuck');
    expect(sourceParsing.profileUrl).toBe('https://www.threads.com/@zuck');
    expect(sourceParsing.canonicalCom).toBe('threads:zuck');
    expect(sourceParsing.canonicalShort).toBe('threads:zuck');

    // 2. Seed slot 0 with a Threads account and cached Threads posts
    const nowIso = new Date().toISOString();
    await page.evaluate(
      ({ timestamp, handlesKey, cacheKey }) => {
        const handles = ['threads:@zuck', 'OpenAI', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'threads:@zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'DVZ8a9bXk12',
                text: 'Shipping Llama 4 and tracking $META and NVDA compute clusters!',
                time: timestamp,
                url: 'https://www.threads.com/@zuck/post/DVZ8a9bXk12',
                author: 'zuck',
                isPinned: true,
                isRetweet: false,
                isQuote: true,
                quoteAuthor: '@mosseri',
                quoteText: 'Threads web updates rolling out today.',
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

    await expect(page.locator('#author-name-0')).toHaveText('Mark Zuckerberg');
    await expect(page.locator('#author-handle-0')).toHaveText('threads:@zuck');
    await expect(page.locator('#slot-card-0')).toHaveClass(/is-threads/);

    const threadsBubble = page.locator('#slot-content-0 .im-bubble.threads').first();
    await expect(threadsBubble).toBeVisible();
    await expect(threadsBubble.locator('.ticker-highlight')).toHaveCount(2);
    await expect(threadsBubble.locator('.ticker-highlight').nth(0)).toHaveText('$META');
    await expect(threadsBubble.locator('.ticker-highlight').nth(1)).toHaveText('NVDA');
    await expect(threadsBubble.locator('.tweet-tag.pinned')).toBeVisible();
    await expect(threadsBubble.locator('.tweet-tag.pinned')).toHaveClass(/mantine-Badge-root/);
    await expect(threadsBubble.locator('.tweet-tag.quote')).toBeVisible();
    await expect(threadsBubble.locator('.tweet-tag.quote')).toHaveClass(/mantine-Badge-root/);

    // 3. Click the Threads bubble to open the zero-latency local Threads popup modal
    const closedPopupWidth = await page
      .locator('#tweet-popup-embed-container')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(closedPopupWidth).toBeGreaterThan(0);

    await threadsBubble.click();
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    await expect(popupOverlay.locator('.tweet-popup-dialog')).toHaveClass(/mantine-Paper-root/);
    const threadsPopupCard = popupOverlay.locator('.threads-popup-card');
    await expect(threadsPopupCard).toBeVisible();
    await expect(threadsPopupCard).toHaveClass(/mantine-Paper-root/);
    await expect(threadsPopupCard.locator('.discord-popup-name')).toHaveText('Mark Zuckerberg');
    await expect(threadsPopupCard.locator('.tweet-tag.threads')).toHaveText('Threads');
    await expect(threadsPopupCard.locator('.tweet-tag.threads')).toHaveClass(/mantine-Badge-root/);
    await expect(threadsPopupCard.locator('.threads-popup-quote .tweet-tag.quote')).toHaveClass(
      /mantine-Badge-root/
    );
    await expect(threadsPopupCard.locator('.threads-popup-quote-author')).toHaveText('@mosseri');
    await expect(threadsPopupCard.locator('.threads-popup-quote-text')).toContainText(
      'Threads web updates rolling out today.'
    );
    await expect(threadsPopupCard.locator('.discord-popup-open-btn')).toBeVisible();
    await expect(threadsPopupCard.locator('.discord-popup-open-btn')).toHaveClass(
      /mantine-UnstyledButton-root/
    );

    // Press Escape to close the Threads popup modal
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    // 4. Verify Threads login item in Accounts menu & Threads refresh interval in Settings
    await page.locator('#btn-login-menu').click();
    await expect(page.locator('#item-login-threads')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('#btn-settings').click();
    await expect(page.locator('#setting-threads-interval')).toBeVisible();
    await page.selectOption('#setting-threads-interval', '15');
    await page.locator('#btn-settings-close').click();

    const savedThreadsInterval = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_THREADS_INTERVAL_KEY
    );
    expect(savedThreadsInterval).toBe('15');

    // 5. Verify dual-platform handle search dropdown when a handle exists on both Twitter & Threads
    await page.evaluate(() => {
      window.__THEYSAY_MOCK_PLATFORM_PROBE = async (handle) => {
        if (handle.toLowerCase() === 'mosseri') {
          return {
            twitter: {
              exists: true,
              handle: 'mosseri',
              displayName: 'Adam',
              avatarUrl: ''
            },
            threads: {
              exists: true,
              handle: 'mosseri',
              displayName: 'Adam Mosseri',
              avatarUrl: ''
            }
          };
        }
        return { twitter: { exists: false }, threads: { exists: false } };
      };
    });

    await page.locator('#slot-author-header-1').click();
    const input1 = page.locator('#handle-input-1');
    await expect(input1).toBeVisible();
    await input1.fill('mosseri');
    await input1.press('Enter');

    const dropdown1 = page.locator('#slot-source-dropdown-1');
    await expect(dropdown1).toBeVisible();
    await expect(dropdown1).toHaveClass(/mantine-Paper-root/);
    await expect(dropdown1.locator('.source-dropdown-item[data-source="twitter"]')).toBeVisible();
    await expect(dropdown1.locator('.source-dropdown-item[data-source="twitter"]')).toHaveClass(
      /mantine-UnstyledButton-root/
    );
    await expect(dropdown1.locator('.source-dropdown-item[data-source="threads"]')).toBeVisible();
    await expect(dropdown1.locator('.source-dropdown-item[data-source="threads"] .source-dropdown-name')).toHaveText(
      'Adam Mosseri'
    );
    await expect(dropdown1.locator('.source-dropdown-badge.threads')).toHaveClass(
      /mantine-Badge-root/
    );

    await dropdown1.locator('.source-dropdown-item[data-source="threads"]').click();
    await expect(dropdown1).toBeHidden();
    await expect(input1).toHaveValue('threads.com/@mosseri');
  });

  test('11. Image post bubbles: full-width layout, 50% right image split, height matching & cached post backfill', async () => {
    const baseMs = Date.now();
    const t0 = new Date(baseMs - 3 * 60000).toISOString();
    const t1 = new Date(baseMs - 2 * 60000).toISOString();
    const t2 = new Date(baseMs - 1 * 60000).toISOString();
    const t3 = new Date(baseMs).toISOString();
    const dummySvgDataUri =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#2563eb"/></svg>'
      );

    await page.evaluate(
      ({ times, imgUri, handlesKey, cacheKey }) => {
        localStorage.setItem(
          'theysay_mock_tweet_data',
          JSON.stringify({
            '998877665544332211': {
              id: '998877665544332211',
              text: 'Cached legacy tweet that originally had no images field saved.',
              images: [imgUri]
            }
          })
        );

        const handles = ['threads:@zuck', '@VitalikButerin', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        const cache = {
          0: {
            handle: 'threads:@zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'post_text_only_1',
                text: 'Short one-line update.',
                time: times[0],
                url: 'https://www.threads.com/@zuck/post/post_text_only_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: []
              },
              {
                id: 'post_with_img_1',
                text: 'Short one-line update.',
                time: times[1],
                url: 'https://www.threads.com/@zuck/post/post_with_img_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: [imgUri]
              },
              {
                id: 'post_z_media_only_1',
                text: '(该推文为纯媒体/卡片内容，无文本)',
                time: times[2],
                url: 'https://www.threads.com/@zuck/post/post_z_media_only_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: [imgUri]
              },
              {
                id: 'post_zz_blank_lines_1',
                text: 'Remember this...\n\nCheap can get cheaper.\n\nOverweight ETF companies have not sold off yet.\n\n$SPY\n$QQQ $IWM',
                time: times[3],
                url: 'https://www.threads.com/@zuck/post/post_zz_blank_lines_1',
                author: 'zuck',
                isPinned: false,
                isRetweet: false,
                isUnread: false,
                images: [imgUri]
              }
            ]
          },
          1: {
            handle: '@VitalikButerin',
            source: 'twitter',
            displayName: 'vitalik.eth',
            userHandle: '@VitalikButerin',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '998877665544332211',
                text: 'Long term\n$QQQ\n model continues to track extremely well.',
                time: times[3],
                url: 'https://x.com/VitalikButerin/status/998877665544332211',
                author: 'VitalikButerin',
                isPinned: false,
                isRetweet: false,
                isUnread: false
                // Intentionally omit `images` and `imagesBackfilled` to simulate old cached posts
              }
            ]
          }
        };
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      },
      {
        times: [t0, t1, t2, t3],
        imgUri: dummySvgDataUri,
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const bubbles = page.locator('#slot-content-0 .im-bubble');
    await expect(bubbles).toHaveCount(4);

    const textOnlyBubble = bubbles.nth(0);
    const mediaBubble = bubbles.nth(1);
    const pureImageBubble = bubbles.nth(2);
    const blankLinesBubble = bubbles.nth(3);

    await expect(textOnlyBubble).not.toHaveClass(/has-media/);
    await expect(mediaBubble).toHaveClass(/has-media/);
    await expect(mediaBubble).not.toHaveClass(/media-only/);
    await expect(mediaBubble.locator('.im-bubble-left')).toBeVisible();
    await expect(mediaBubble.locator('.im-media-grid .im-media-thumb .im-media-img')).toBeVisible();

    // Pure-image bubble displays only the image without "(该推文为纯媒体/卡片内容，无文本)"
    await expect(pureImageBubble).toHaveClass(/has-media/);
    await expect(pureImageBubble).toHaveClass(/media-only/);
    await expect(pureImageBubble.locator('.im-text-content')).toHaveCount(0);
    await expect(pureImageBubble.locator('.im-media-grid .im-media-thumb .im-media-img')).toBeVisible();

    // Blank lines are stripped in bubble display, last line expands past 100 chars when space is available,
    // and original blank lines are preserved in popup modal when clicked
    const bubbleDisplayText = await blankLinesBubble.locator('.im-text-content').textContent();
    expect(bubbleDisplayText).toBe(
      'Remember this...\nCheap can get cheaper.\nOverweight ETF companies have not sold off yet. $SPY $QQQ $IWM'
    );
    await blankLinesBubble.click();
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const popupText = await popupOverlay.locator('.threads-popup-card .discord-popup-text').textContent();
    expect(popupText).toBe(
      'Remember this...\n\nCheap can get cheaper.\n\nOverweight ETF companies have not sold off yet.\n\n$SPY\n$QQQ $IWM'
    );
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    const metrics = await page.evaluate(() => {
      const listEl = document.getElementById('slot-posts-list-0');
      const listStyle = getComputedStyle(listEl);
      const listInnerWidth =
        listEl.clientWidth -
        parseFloat(listStyle.paddingLeft || '0') -
        parseFloat(listStyle.paddingRight || '0');

      const [bText, bMedia] = Array.from(listEl.querySelectorAll('.im-bubble'));
      const bMediaStyle = getComputedStyle(bMedia);
      const mediaInnerWidth =
        bMedia.clientWidth -
        parseFloat(bMediaStyle.paddingLeft || '0') -
        parseFloat(bMediaStyle.paddingRight || '0');

      const leftCol = bMedia.querySelector('.im-bubble-left');
      const rightMedia = bMedia.querySelector('.im-media-grid');

      const bTextRect = bText.getBoundingClientRect();
      const bMediaRect = bMedia.getBoundingClientRect();
      const leftRect = leftCol.getBoundingClientRect();
      const rightRect = rightMedia.getBoundingClientRect();

      return {
        listInnerWidth,
        mediaInnerWidth,
        textBubbleWidth: bTextRect.width,
        mediaBubbleWidth: bMediaRect.width,
        textBubbleHeight: bTextRect.height,
        mediaBubbleHeight: bMediaRect.height,
        leftWidth: leftRect.width,
        rightWidth: rightRect.width,
        leftX: leftRect.left,
        leftRightEdge: leftRect.right,
        rightX: rightRect.left
      };
    });

    // 1. Media bubble fills 100% of the slot list inner width and is wider than normal text bubble
    expect(Math.abs(metrics.mediaBubbleWidth - metrics.listInnerWidth)).toBeLessThanOrEqual(1.5);
    expect(metrics.mediaBubbleWidth).toBeGreaterThan(metrics.textBubbleWidth);

    // 2. Left side is text, right side is image thumbnail occupying ~50% of the bubble inner width
    expect(metrics.rightX).toBeGreaterThanOrEqual(metrics.leftRightEdge);
    const rightWidthRatio = metrics.rightWidth / metrics.mediaInnerWidth;
    expect(rightWidthRatio).toBeGreaterThanOrEqual(0.45);
    expect(rightWidthRatio).toBeLessThanOrEqual(0.55);

    // 3. Thumbnail matches the original bubble height without inflating it vertically
    expect(Math.abs(metrics.mediaBubbleHeight - metrics.textBubbleHeight)).toBeLessThanOrEqual(1);

    // 4. Cached legacy Twitter post in Slot 1 automatically backfills its image and cleans inline $QQQ newlines
    const backfilledBubble = page.locator('#slot-content-1 .im-bubble').first();
    await expect(backfilledBubble).toHaveClass(/has-media/);
    await expect(backfilledBubble.locator('.im-media-grid .im-media-thumb .im-media-img')).toBeVisible();
    const cleanedText = await backfilledBubble.locator('.im-text-content').textContent();
    expect(cleanedText).toBe('Long term $QQQ model continues to track extremely well.');

    // 5. Verify Twitter fallback popup card renders via Mantine Paper, Badge, and UnstyledButton
    await page.evaluate(() => {
      const { openPostPopup } = require('./src/ui/popup');
      openPostPopup({
        id: '998877665544332211',
        source: 'twitter',
        displayName: 'vitalik.eth',
        userHandle: '@VitalikButerin',
        text: 'Subscriber alpha on $ETH and $QQQ.',
        time: '12:00 PM',
        url: 'https://x.com/VitalikButerin/status/998877665544332211',
        isMemberOnly: true,
        hasQuote: true,
        quoteUrl: 'https://x.com/ethereum/status/112233'
      });
    });
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const fallbackCard = popupOverlay.locator('.tweet-popup-fallback');
    await expect(fallbackCard).toBeVisible();
    await expect(fallbackCard).toHaveClass(/mantine-Paper-root/);
    await expect(fallbackCard.locator('.tweet-tag.member')).toHaveClass(/mantine-Badge-root/);
    await expect(fallbackCard.locator('.tweet-tag.quote')).toHaveClass(/mantine-Badge-root/);
    await expect(fallbackCard.locator('.tweet-popup-fallback-btn')).toHaveClass(
      /mantine-UnstyledButton-root/
    );
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);
  });

  test('12. Same-minute message merging: Discord merges with Chinese (。) & English (.) separators, while Twitter & Threads do not merge', async () => {
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const handles = [
          'https://discord.com/channels/111111/222222',
          'threads:@zuck',
          '@elonmusk',
          ''
        ];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));

        // 5 Chinese messages within the exact same minute (19:47) + 2 English messages in the next minute (19:48)
        const baseMinute = '2026-10-23T19:47:';
        const nextMinutePrefix = '2026-10-23T19:48:';

        const cache = {
          0: {
            handle: 'https://discord.com/channels/111111/222222',
            source: 'discord',
            sourceTitle: '#trading',
            sourceSubtitle: 'Alpha Guild',
            displayName: '#trading',
            userHandle: 'Alpha Guild',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '1001',
                text: 'add了 igv + panw put',
                datetime: `${baseMinute}02.000Z`,
                time: `${baseMinute}02.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1002',
                text: 'igv 110左右是上周五大阴线的起点',
                datetime: `${baseMinute}15.000Z`,
                time: `${baseMinute}15.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1003',
                text: '这里今天拉回去就被抛售是很bearish的',
                datetime: `${baseMinute}28.000Z`,
                time: `${baseMinute}28.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1004',
                text: '做空，盈亏比很高，拉过去我们就止损',
                datetime: `${baseMinute}41.000Z`,
                time: `${baseMinute}41.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1005',
                text: '很多 igv 的估值比半导体还高，而且当前软件板块整体面临非常明显的估值压缩压力，长线资金也在持续撤出高估值SaaS标的，反弹就是很好的加仓做空机会',
                datetime: `${baseMinute}55.000Z`,
                time: `${baseMinute}55.000Z`,
                displayName: 'TraderA',
                isUnread: true,
                images: []
              },
              {
                id: '1006',
                text: 'Added igv and panw puts at the open today as software names hit major overhead supply',
                datetime: `${nextMinutePrefix}10.000Z`,
                time: `${nextMinutePrefix}10.000Z`,
                displayName: 'TraderA',
                isUnread: false,
                images: []
              },
              {
                id: '1007',
                text: '110 on igv was the exact origin of last Friday breakdown candle and getting rejected right here is extremely bearish for the sector',
                datetime: `${nextMinutePrefix}35.000Z`,
                time: `${nextMinutePrefix}35.000Z`,
                displayName: 'TraderA',
                isUnread: false,
                images: []
              }
            ]
          },
          1: {
            handle: 'threads:@zuck',
            source: 'threads',
            displayName: 'Mark Zuckerberg',
            userHandle: 'threads:@zuck',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: 'en_msg_1',
                text: 'Added igv and panw puts at the open today as software names hit major overhead supply',
                datetime: `${baseMinute}05.000Z`,
                time: `${baseMinute}05.000Z`,
                url: 'https://www.threads.com/@zuck/post/en_msg_1',
                author: 'zuck',
                isUnread: false,
                images: []
              },
              {
                id: 'en_msg_2',
                text: '110 on igv was the exact origin of last Friday breakdown candle and getting rejected right here is extremely bearish for the sector.\nSecond paragraph with more details that definitely exceeds the 100 character limit and must be truncated.',
                datetime: `${baseMinute}35.000Z`,
                time: `${baseMinute}35.000Z`,
                url: 'https://www.threads.com/@zuck/post/en_msg_2',
                author: 'zuck',
                isUnread: false,
                images: []
              }
            ]
          },
          2: {
            handle: '@elonmusk',
            source: 'twitter',
            displayName: 'Elon Musk',
            userHandle: '@elonmusk',
            avatarUrl: '',
            lastFetchedAt: Date.now(),
            posts: [
              {
                id: '2001',
                text: 'Every time DCA Optimizer flashed a buy signal on $UBER ...\n14 signal months. Average price move 12 months later: +34.1%.\nThe ONE time it hit 4X Extreme Buy Zone? +111.0%\nTry it FREE for 7 days:',
                datetime: `${baseMinute}12.000Z`,
                time: `${baseMinute}12.000Z`,
                url: 'https://x.com/elonmusk/status/2001',
                author: 'elonmusk',
                isUnread: false,
                images: []
              },
              {
                id: '2002',
                text: 'Follow-up thread reply posted in the exact same minute.',
                datetime: `${baseMinute}40.000Z`,
                time: `${baseMinute}40.000Z`,
                url: 'https://x.com/elonmusk/status/2002',
                author: 'elonmusk',
                isUnread: false,
                images: []
              }
            ]
          }
        };
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    // Slot 0 (Discord): 5 Chinese messages at 19:47 merge into 1 bubble + 2 English messages at 19:48 merge into 1 bubble = 2 bubbles total
    const discordBubbles = page.locator('#slot-content-0 .im-bubble');
    await expect(discordBubbles).toHaveCount(2);

    const mergedChineseBubble = discordBubbles.nth(0);
    await expect(mergedChineseBubble).toHaveClass(/unread/);
    // Merged Discord bubble must NOT be truncated even though it exceeds 100 chars
    await expect(mergedChineseBubble.locator('.im-text-ellipsis')).toHaveCount(0);

    const chineseText = await mergedChineseBubble.locator('.im-text-content').textContent();
    expect(chineseText).toBe(
      'add了 igv + panw put。igv 110左右是上周五大阴线的起点。这里今天拉回去就被抛售是很bearish的。做空，盈亏比很高，拉过去我们就止损。很多 igv 的估值比半导体还高，而且当前软件板块整体面临非常明显的估值压缩压力，长线资金也在持续撤出高估值SaaS标的，反弹就是很好的加仓做空机会'
    );

    // Tickers (igv x3, panw x1) are highlighted inside the merged Chinese bubble
    await expect(mergedChineseBubble.locator('.ticker-highlight')).toHaveCount(4);

    // Clicking the merged bubble marks all 5 underlying messages as read and opens popup with full merged text
    await mergedChineseBubble.click();
    await expect(page.locator('#slot-unread-badge-0')).toBeHidden();
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    await expect(popupOverlay.locator('.discord-embed-slot .discord-popup-card')).toHaveClass(
      /mantine-Paper-root/
    );
    await expect(popupOverlay.locator('.discord-popup-text')).toHaveText(chineseText);
    await page.keyboard.press('Escape');
    await expect(popupOverlay).toHaveClass(/is-closed/);

    // Second Discord bubble: 2 English messages in the same minute merge into 1 bubble separated by ". " and are not truncated
    const mergedEnglishBubble = discordBubbles.nth(1);
    await expect(mergedEnglishBubble.locator('.im-text-ellipsis')).toHaveCount(0);
    const englishText = await mergedEnglishBubble.locator('.im-text-content').textContent();
    expect(englishText).toBe(
      'Added igv and panw puts at the open today as software names hit major overhead supply. 110 on igv was the exact origin of last Friday breakdown candle and getting rejected right here is extremely bearish for the sector'
    );

    // Slot 1 (Threads): 2 posts in the same minute must NOT merge and long post must be truncated
    const threadsBubbles = page.locator('#slot-content-1 .im-bubble');
    await expect(threadsBubbles).toHaveCount(2);
    await expect(threadsBubbles.nth(1).locator('.im-text-ellipsis')).toHaveCount(1);

    // Slot 2 (Twitter): 2 tweets in the same minute must NOT merge and long tweet must be truncated
    const twitterBubbles = page.locator('#slot-content-2 .im-bubble');
    await expect(twitterBubbles).toHaveCount(2);
    await expect(twitterBubbles.nth(0).locator('.im-text-ellipsis')).toHaveCount(1);
    const truncatedTweetText = await twitterBubbles.nth(0).locator('.im-text-content').textContent();
    expect(truncatedTweetText).not.toContain('Try it FREE for 7 days:');
  });

  test('13. Hovering a slot content area hides its header to reveal obscured content and moving to top header area restores it', async () => {
    const card0 = page.locator('#slot-card-0');
    const header0 = card0.locator('.slot-header');
    const content0 = page.locator('#slot-content-0');
    const header1 = page.locator('#slot-card-1 .slot-header');

    // Verify content container spans full card height behind overlay header
    const geometry = await page.evaluate(() => {
      const cRect = document.getElementById('slot-card-0').getBoundingClientRect();
      const hRect = document.querySelector('#slot-card-0 .slot-header').getBoundingClientRect();
      const ctRect = document.getElementById('slot-content-0').getBoundingClientRect();
      return {
        cardTop: cRect.top,
        cardHeight: cRect.height,
        headerTop: hRect.top,
        headerHeight: hRect.height,
        contentTop: ctRect.top,
        contentHeight: ctRect.height
      };
    });
    expect(Math.abs(geometry.contentTop - geometry.cardTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.contentHeight - geometry.cardHeight)).toBeLessThanOrEqual(4);
    expect(geometry.headerHeight).toBe(28);

    // Move cursor to top navbar (outside all slot cards): header is visible
    await page.mouse.move(100, 15);
    await expect(card0).not.toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(1);

    // Move cursor into slot 0's lower message content area: slot 0's header hides, slot 1's header stays visible
    const contentBox = await content0.boundingBox();
    await page.mouse.move(contentBox.x + contentBox.width / 2, contentBox.y + contentBox.height / 2);
    await expect(card0).toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(0);
    await expect.poll(() =>
      header1.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(1);

    // Move cursor to the right edge resize handle (.ui-resizable-e where horizontal resize arrow appears):
    // header must remain hidden, and clicking on the resize handle area expands/restores the section
    const item0 = page.locator('.grid-stack-item[data-slot-index="0"]');
    const cornerHandleStyles = await item0.evaluate((el) => {
      const se = el.querySelector(':scope > .ui-resizable-se');
      const sw = el.querySelector(':scope > .ui-resizable-sw');
      const seStyle = se ? getComputedStyle(se) : null;
      const swStyle = sw ? getComputedStyle(sw) : null;
      const seAfter = se ? getComputedStyle(se, '::after') : null;
      return {
        seBg: seStyle ? seStyle.backgroundImage : null,
        swBg: swStyle ? swStyle.backgroundImage : null,
        seCursor: seStyle ? seStyle.cursor : null,
        swCursor: swStyle ? swStyle.cursor : null,
        seAfterContent: seAfter ? seAfter.content : null
      };
    });
    expect(cornerHandleStyles.seBg).toBe('none');
    expect(cornerHandleStyles.swBg).toBe('none');
    expect(cornerHandleStyles.seCursor).toBe('se-resize');
    expect(cornerHandleStyles.swCursor).toBe('sw-resize');
    expect(cornerHandleStyles.seAfterContent).toBe('none');

    const squeezedItems = page.locator('.grid-stack-item.is-hover-squeezed');
    const resizeEastBox = await page
      .locator('.grid-stack-item[data-slot-index="0"] > .ui-resizable-e')
      .boundingBox();
    const resizeClickX = resizeEastBox.x + resizeEastBox.width / 2;
    const resizeClickY = resizeEastBox.y + resizeEastBox.height / 2;
    await page.mouse.move(resizeClickX, resizeClickY);
    await expect(card0).toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(0);

    // Click on the resize arrow area (.ui-resizable-e) to expand slot 0 in its column
    await page.mouse.click(resizeClickX, resizeClickY);
    await expect(item0).toHaveClass(/is-hover-expanded/);
    await expect(squeezedItems).toHaveCount(1);

    // Click on the resize arrow area again to restore column heights
    await page.mouse.click(resizeClickX, resizeClickY);
    await expect(item0).not.toHaveClass(/is-hover-expanded/);
    await expect(squeezedItems).toHaveCount(0);

    // Move cursor up to slot 0's top header area: slot 0's header reappears for button/drag interaction
    const headerBox = await header0.boundingBox();
    await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
    await expect(card0).not.toHaveClass(/is-header-hidden/);
    await expect.poll(() =>
      header0.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    ).toBe(1);
  });

  test('14. Login expiration vs initial unlogged-in state: persistent banner, per-slot prompt & recovery on login', async () => {
    // Part A: Simulate a fresh first-time install (never logged into Discord/Twitter/Threads, no Discord cache)
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        localStorage.removeItem('theysay_discord_logged_in');
        localStorage.removeItem('theysay_discord_ever_logged_in');
        localStorage.removeItem('theysay_discord_login_expired');
        localStorage.removeItem('theysay_twitter_ever_logged_in');
        localStorage.removeItem('theysay_twitter_login_expired');
        localStorage.removeItem('theysay_threads_logged_in');
        localStorage.removeItem('theysay_threads_ever_logged_in');
        localStorage.removeItem('theysay_threads_login_expired');
        localStorage.removeItem('theysay_target_cache');
        localStorage.removeItem('theysay_target_cache_v1');

        const handles = ['elonmusk', '', '', ''];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));
        localStorage.setItem(cacheKey, JSON.stringify({}));
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const topBanner = page.locator('#auth-expired-banner');
    const discordBadge = page.locator('#discord-status-badge');
    const discordLabel = page.locator('#discord-status-label');
    const menuDot = page.locator('#login-menu-status-dot');
    const menuBtn = page.locator('#btn-login-menu');

    // Initial unlogged-in state must NOT show any login-expired banner or warning
    await expect(topBanner).toBeHidden();
    await expect(discordBadge).toHaveClass(/logged-out/);
    await expect(discordBadge).not.toHaveClass(/expired/);
    await expect(discordLabel).toHaveText('未登录');
    await expect(menuDot).not.toHaveClass(/has-expired/);
    await expect(menuBtn).not.toHaveClass(/has-expired/);
    await expect(page.locator('#slot-expired-banner-0')).toBeHidden();

    // Even if an unlogged-in user tries a Discord slot before ever logging in (force: false),
    // it remains in the initial unlogged-in state without triggering the global expired banner
    await page.evaluate(() => {
      const { markPlatformLoginExpired } = require('./src/ui/auth');
      markPlatformLoginExpired('discord', { force: false });
    });
    await expect(topBanner).toBeHidden();
    await expect(discordLabel).toHaveText('未登录');

    // Part B: Simulate an existing Discord user whose session has expired (cached Discord messages + logged_in = '0')
    await page.evaluate(
      ({ handlesKey, cacheKey }) => {
        const handles = [
          'https://discord.com/channels/100000000000000001/200000000000000002',
          'elonmusk',
          '',
          ''
        ];
        while (handles.length < 16) handles.push('');
        localStorage.setItem(handlesKey, JSON.stringify(handles));
        localStorage.setItem('theysay_discord_logged_in', '0');

        const cache = {
          0: {
            handle: 'https://discord.com/channels/100000000000000001/200000000000000002',
            source: 'discord',
            sourceTitle: '#general',
            sourceSubtitle: 'AlphaResearch',
            displayName: '#general',
            userHandle: 'AlphaResearch',
            avatarUrl: '',
            lastFetchedAt: Date.now() - 3600000,
            posts: [
              {
                id: 'msg_oct23',
                text: 'Previous cached message from Discord channel',
                datetime: '2026-10-23T18:55:00.000Z',
                time: '2026-10-23T18:55:00.000Z',
                displayName: 'Analyst',
                isUnread: false,
                images: []
              }
            ]
          }
        };
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      },
      {
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    // Global top banner must be prominently visible and have NO close button
    await expect(topBanner).toBeVisible();
    await expect(topBanner.locator('.auth-expired-banner-text')).toContainText(
      'Discord 登录已过期，无法拉取最新消息，请重新登录以恢复更新。'
    );
    const bannerLoginBtn = topBanner.locator('.auth-expired-login-btn[data-platform="discord"]');
    await expect(bannerLoginBtn).toBeVisible();
    await expect(bannerLoginBtn).toHaveText('立即登录 Discord');
    await expect(topBanner.locator('button')).toHaveCount(1);

    // Header account button & Discord dropdown badge show expired state
    await expect(menuDot).toHaveClass(/has-expired/);
    await expect(menuBtn).toHaveClass(/has-expired/);
    await expect(discordBadge).toHaveClass(/expired/);
    await expect(discordLabel).toHaveText('登录已过期');

    // Discord slot (Slot 0) shows per-slot expired banner; Twitter slot (Slot 1) does not
    await expect(page.locator('#slot-card-0')).toHaveClass(/is-login-expired/);
    await expect(page.locator('#slot-expired-banner-0')).toBeVisible();
    await expect(page.locator('#slot-expired-text-0')).toHaveText('Discord 登录已过期，无法更新最新消息');
    await expect(page.locator('#slot-expired-btn-0')).toHaveText('重新登录');
    await expect(page.locator('#slot-expired-banner-1')).toBeHidden();

    // Pressing Escape or clicking elsewhere must NOT dismiss the banner before logging in
    await page.keyboard.press('Escape');
    await page.mouse.click(20, 20);
    await expect(topBanner).toBeVisible();
    await expect(page.locator('#slot-expired-banner-0')).toBeVisible();

    // Verify updateSlotHeaderMeta helper works without error
    await page.evaluate(() => {
      const { updateSlotHeaderMeta } = require('./src/ui/slot');
      const slotEl = document.getElementById('author-name-0');
      const fakeSlot = {
        source: 'discord',
        sourceTitle: '#general',
        sourceSubtitle: 'AlphaResearch',
        authorName: slotEl,
        authorHandle: document.getElementById('author-handle-0'),
        authorHeader: document.getElementById('slot-author-header-0'),
        lastFetchedAt: Date.now()
      };
      updateSlotHeaderMeta(fakeSlot, {
        source: 'discord',
        title: '#general',
        subtitle: 'AlphaResearch'
      });
    });

    // Part C: Simulate user completing Discord login; banner and slot warning must disappear immediately
    await electronApp.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) {
        wins[0].webContents.send('discord-login-status-changed', { loggedIn: true });
      }
    });

    await expect(topBanner).toBeHidden();
    await expect(page.locator('#slot-expired-banner-0')).toBeHidden();
    await expect(page.locator('#slot-card-0')).not.toHaveClass(/is-login-expired/);
    await expect(discordBadge).toHaveClass(/logged-in/);
    await expect(discordLabel).toHaveText('已登录');
    await expect(menuDot).toHaveClass(/has-login/);
    await expect(menuDot).not.toHaveClass(/has-expired/);
  });

  test('17. Long URLs in messages resolve and display webpage <title> instead of raw links in bubbles and popups', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      const reqUrl = req.url || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (reqUrl.startsWith('/p/10262026-trading-recap-and-outlook')) {
        res.end('<!doctype html><html><head><title>10/26/2026 Trading Recap and Outlook - Alpha&#x27;s Substack</title></head><body>Recap</body></html>');
      } else if (reqUrl.startsWith('/p/10262026')) {
        res.end('<!doctype html><html><head><title>10/26/2026 复盘与展望 - Alpha&#x27;s Substack</title></head><body>复盘</body></html>');
      } else {
        res.end('<!doctype html><html><head><title>Default Page Title</title></head><body>ok</body></html>');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const longUrl1 = `http://127.0.0.1:${port}/p/10262026?r=2wn5pz&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true`;
    const longUrl2 = `http://127.0.0.1:${port}/p/10262026-trading-recap-and-outlook?r=2wn5pz&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true`;

    try {
      await page.evaluate(
        ({ handlesKey, cacheKey, u1, u2 }) => {
          localStorage.removeItem('theysay_url_titles_cache');
          const handles = [
            'https://discord.com/channels/100000000000000001/200000000000000002',
            '',
            '',
            ''
          ];
          while (handles.length < 16) handles.push('');
          localStorage.setItem(handlesKey, JSON.stringify(handles));
          localStorage.setItem('theysay_discord_logged_in', '1');

          const cache = {
            0: {
              handle: 'https://discord.com/channels/100000000000000001/200000000000000002',
              source: 'discord',
              sourceTitle: '#general',
              sourceSubtitle: 'AlphaResearch',
              displayName: '#general',
              userHandle: 'AlphaResearch',
              avatarUrl: '',
              lastFetchedAt: Date.now(),
              posts: [
                {
                  id: '1499000000000000001',
                  text: u1,
                  datetime: '2026-10-26T11:44:10.000Z',
                  time: '2026-10-26T11:44:10.000Z',
                  displayName: 'AlphaAnalyst',
                  url: 'https://discord.com/channels/100000000000000001/200000000000000002/1499000000000000001',
                  isUnread: false,
                  images: [],
                  attachments: ['嵌入卡片']
                },
                {
                  id: '1499000000000000002',
                  text: u2,
                  datetime: '2026-10-26T11:44:25.000Z',
                  time: '2026-10-26T11:44:25.000Z',
                  displayName: 'AlphaAnalyst',
                  url: 'https://discord.com/channels/100000000000000001/200000000000000002/1499000000000000002',
                  isUnread: false,
                  images: [],
                  attachments: ['嵌入卡片']
                },
                {
                  id: '1499000000000000003',
                  text: u2,
                  datetime: '2026-10-26T11:50:00.000Z',
                  time: '2026-10-26T11:50:00.000Z',
                  displayName: 'AlphaAnalyst',
                  url: 'https://discord.com/channels/100000000000000001/200000000000000002/1499000000000000003',
                  isUnread: false,
                  images: []
                }
              ]
            }
          };
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        },
        {
          handlesKey: STORAGE_HANDLES_KEY,
          cacheKey: STORAGE_CACHE_KEY,
          u1: longUrl1,
          u2: longUrl2
        }
      );

      await page.reload({ waitUntil: 'domcontentloaded' });

      const bubbles = page.locator('#slot-posts-list-0 .im-bubble');
      await expect(bubbles).toHaveCount(2);

      const mergedBubbleText = bubbles.nth(0).locator('.im-text-content');
      const singleBubbleText = bubbles.nth(1).locator('.im-text-content');

      // Wait for async URL title resolution to update both bubbles in place
      await expect(mergedBubbleText).toContainText("10/26/2026 复盘与展望 - Alpha's Substack");
      await expect(mergedBubbleText).toContainText("10/26/2026 Trading Recap and Outlook - Alpha's Substack");
      await expect(mergedBubbleText).not.toContainText('showWelcomeOnShare=true');

      // Single post with >100-char raw URL should display its 55-char title without '...' truncation
      await expect(singleBubbleText).toHaveText("10/26/2026 Trading Recap and Outlook - Alpha's Substack");
      await expect(singleBubbleText.locator('.im-text-ellipsis')).toHaveCount(0);

      // Click the merged bubble to open the popup and verify popup links show titles and keep original URLs
      await bubbles.nth(0).click();
      const overlay = page.locator('#tweet-popup-overlay');
      await expect(overlay).not.toHaveClass(/is-closed/);

      const popupLinks = overlay.locator('.discord-popup-text .popup-inline-link');
      await expect(popupLinks).toHaveCount(2);
      await expect(popupLinks.nth(0)).toHaveText("10/26/2026 复盘与展望 - Alpha's Substack");
      await expect(popupLinks.nth(0)).toHaveAttribute('data-url', longUrl1);
      await expect(popupLinks.nth(1)).toHaveText("10/26/2026 Trading Recap and Outlook - Alpha's Substack");
      await expect(popupLinks.nth(1)).toHaveAttribute('data-url', longUrl2);

      await page.keyboard.press('Escape');
      await expect(overlay).toHaveClass(/is-closed/);

      // Verify linkify-it + tlds, normalize-url, and colord behavior
      const linkifyCheck = await page.evaluate(() => {
        const {
          extractUrlsFromText,
          formatTextWithTickers,
          registerUrlTitle,
          getCachedUrlTitle
        } = require('./src/core/ticker');
        const { resolveHeaderPalette, normalizeHexColor } = require('./src/ui/theme');

        registerUrlTitle(
          'https://example.com:443/report/?b=2&utm_source=twitter&a=1#section',
          'Normalized Report Title',
          { persist: false }
        );
        const canonicalHit = getCachedUrlTitle('https://example.com/report?a=1&b=2&fbclid=xyz');

        const sample =
          '看下https://en.wikipedia.org/wiki/Apple_(company)，以及 defillama.finance/chains 和 @elonmusk 提到的 $NVDA (还有 coin.market 域名)';
        return {
          urls: extractUrlsFromText(sample),
          html: formatTextWithTickers(sample, sample, {
            linkifyUrls: true,
            linkTitles: {
              'https://en.wikipedia.org/wiki/Apple_(company)': 'Apple Inc. - Wikipedia'
            }
          }),
          canonicalHit,
          normalizedHex: normalizeHexColor('1E293B'),
          darkPalette: resolveHeaderPalette('#1e293b'),
          lightPalette: resolveHeaderPalette('#f1f5f9')
        };
      });
      expect(linkifyCheck.urls).toEqual([
        'https://en.wikipedia.org/wiki/Apple_(company)',
        'defillama.finance/chains'
      ]);
      expect(linkifyCheck.html).toContain('Apple Inc. - Wikipedia');
      expect(linkifyCheck.html).toContain('<span class="ticker-highlight">$NVDA</span>');
      // 'coin' inside bare domain 'coin.market' must not be highlighted as a ticker
      expect(linkifyCheck.html).not.toContain('<span class="ticker-highlight">coin</span>');
      expect(linkifyCheck.canonicalHit).toBe('Normalized Report Title');
      expect(linkifyCheck.normalizedHex).toBe('#1e293b');
      expect(linkifyCheck.darkPalette.text).toBe('#f8fafc');
      expect(linkifyCheck.lightPalette.text).toBe('#0f1419');

      // Verify .background-webviews-container matches window innerWidth/innerHeight (preventing Discord DevTools hideToken)
      // and verify Discord auth token backup / LevelDB recovery IPC round-trip
      const discordGuardCheck = await page.evaluate(async () => {
        const { ipcRenderer } = require('electron');
        const bg = document.querySelector('.background-webviews-container');
        const rect = bg.getBoundingClientRect();
        const widthDiff = Math.abs(rect.width - window.innerWidth);
        const heightDiff = Math.abs(rect.height - window.innerHeight);

        const sampleToken = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-';
        ipcRenderer.send('discord-auth-captured', {
          token: sampleToken,
          userId: '100000000000000001',
          tokens: { '100000000000000001': sampleToken },
          multiAccountStore: {
            _state: { users: [{ id: '100000000000000001', username: 'test_user', tokenStatus: 0 }] },
            _version: 2
          }
        });
        const backup = await ipcRenderer.invoke('get-discord-auth-backup');
        await ipcRenderer.invoke('clear-discord-auth-backup');
        const afterClear = await ipcRenderer.invoke('get-discord-auth-backup');

        return {
          widthDiff,
          heightDiff,
          backedUpToken: backup && backup.token,
          backedUpStatus:
            backup &&
            backup.multiAccountStore &&
            backup.multiAccountStore._state.users[0].tokenStatus,
          afterClear
        };
      });
      expect(discordGuardCheck.widthDiff).toBeLessThanOrEqual(1);
      expect(discordGuardCheck.heightDiff).toBeLessThanOrEqual(1);
      expect(discordGuardCheck.backedUpToken).toBe(
        'MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-'
      );
      expect(discordGuardCheck.backedUpStatus).toBe(2);
      expect(discordGuardCheck.afterClear).toBeNull();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});



