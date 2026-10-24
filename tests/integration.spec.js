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

    // Reopen Settings Modal, modify settings (auto-saved immediately), and close
    await page.locator('#btn-settings').click();
    await expect(settingsOverlay).not.toHaveClass(/is-closed/);

    await page.selectOption('#setting-twitter-interval', '15');
    await page.locator('#setting-header-presets .header-preset-chip[data-bg="#2563eb"]').click();
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
    await expect(page.locator('#slot-unread-badge-0')).toContainText('1');

    // Verify post bubble and stock ticker highlights ($NVDA and AAPL)
    const postBubble = page.locator('#slot-content-0 .im-bubble').first();
    await expect(postBubble).toBeVisible();
    await expect(postBubble).toHaveClass(/unread/);

    const tickerChips = postBubble.locator('.ticker-highlight');
    await expect(tickerChips).toHaveCount(2);
    await expect(tickerChips.nth(0)).toHaveText('$NVDA');
    await expect(tickerChips.nth(1)).toHaveText('AAPL');

    // Click Mark All Read and verify unread state clears
    await page.locator('#btn-mark-all-read').click();
    await expect(postBubble).not.toHaveClass(/unread/);
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
    await expect(page.locator('#btn-mark-all-read span')).toHaveText('Mark All Read');
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
    await expect(page.locator('#btn-mark-all-read span')).toHaveText('全部已读');
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
    await expect(threadsBubble.locator('.tweet-tag.quote')).toBeVisible();

    // 3. Click the Threads bubble to open the zero-latency local Threads popup modal
    await threadsBubble.click();
    const popupOverlay = page.locator('#tweet-popup-overlay');
    await expect(popupOverlay).not.toHaveClass(/is-closed/);
    const threadsPopupCard = popupOverlay.locator('.threads-popup-card');
    await expect(threadsPopupCard).toBeVisible();
    await expect(threadsPopupCard.locator('.discord-popup-name')).toHaveText('Mark Zuckerberg');
    await expect(threadsPopupCard.locator('.tweet-tag.threads')).toHaveText('Threads');
    await expect(threadsPopupCard.locator('.threads-popup-quote-author')).toHaveText('@mosseri');
    await expect(threadsPopupCard.locator('.threads-popup-quote-text')).toContainText(
      'Threads web updates rolling out today.'
    );
    await expect(threadsPopupCard.locator('.discord-popup-open-btn')).toBeVisible();

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
    await expect(dropdown1.locator('.source-dropdown-item[data-source="twitter"]')).toBeVisible();
    await expect(dropdown1.locator('.source-dropdown-item[data-source="threads"]')).toBeVisible();
    await expect(dropdown1.locator('.source-dropdown-item[data-source="threads"] .source-dropdown-name')).toHaveText(
      'Adam Mosseri'
    );

    await dropdown1.locator('.source-dropdown-item[data-source="threads"]').click();
    await expect(dropdown1).toBeHidden();
    await expect(input1).toHaveValue('threads.com/@mosseri');
  });

  test('11. Image post bubbles: full-width layout, 50% right image split, height matching & cached post backfill', async () => {
    const nowIso = new Date().toISOString();
    const dummySvgDataUri =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#2563eb"/></svg>'
      );

    await page.evaluate(
      ({ timestamp, imgUri, handlesKey, cacheKey }) => {
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
                time: timestamp,
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
                time: timestamp,
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
                time: timestamp,
                url: 'https://www.threads.com/@zuck/post/post_z_media_only_1',
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
                time: timestamp,
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
        timestamp: nowIso,
        imgUri: dummySvgDataUri,
        handlesKey: STORAGE_HANDLES_KEY,
        cacheKey: STORAGE_CACHE_KEY
      }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });

    const bubbles = page.locator('#slot-content-0 .im-bubble');
    await expect(bubbles).toHaveCount(3);

    const textOnlyBubble = bubbles.nth(0);
    const mediaBubble = bubbles.nth(1);
    const pureImageBubble = bubbles.nth(2);

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
  });
});

