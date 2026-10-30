const fs = require('fs');
const path = require('path');
const semver = require('semver');

const GITHUB_OWNER = 'laike9m';
const GITHUB_REPO = 'TheySay';
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

let mockReleaseData = null;
let lastUpdateState = {
  state: 'idle',
  currentVersion: '1.0.0',
  latestVersion: null,
  updateAvailable: false,
  releaseName: '',
  releaseNotes: '',
  htmlUrl: GITHUB_RELEASES_URL,
  publishedAt: null,
  asset: null,
  percent: 0,
  downloadedPath: null,
  mode: null,
  error: null
};
let downloadedViaAutoUpdater = false;
let activeDownloadPromise = null;

function normalizeVersionString(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^v/i, '');
  const cleaned = semver.clean(trimmed);
  if (cleaned) return cleaned;
  const coerced = semver.coerce(trimmed);
  return coerced ? coerced.version : null;
}

function isNewerVersion(candidate, current) {
  const normCandidate = normalizeVersionString(candidate);
  const normCurrent = normalizeVersionString(current);
  if (!normCandidate || !normCurrent) return false;
  return semver.gt(normCandidate, normCurrent);
}

function selectPlatformReleaseAsset(
  assets,
  { platform = process.platform, arch = process.arch, env = process.env } = {}
) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  const usable = assets.filter((a) => {
    if (!a || typeof a.name !== 'string') return false;
    const name = a.name.toLowerCase();
    if (name.endsWith('.blockmap') || name.endsWith('.yml') || name.endsWith('.yaml')) {
      return false;
    }
    return Boolean(a.browser_download_url || a.url);
  });

  if (usable.length === 0) return null;

  const normalizeAsset = (a) => ({
    name: a.name,
    url: a.browser_download_url || a.url,
    size: typeof a.size === 'number' ? a.size : 0
  });

  if (platform === 'darwin') {
    const archTag = arch === 'x64' ? 'x64' : 'arm64';
    const dmgs = usable.filter((a) => a.name.toLowerCase().endsWith('.dmg'));
    const archDmg = dmgs.find((a) => a.name.toLowerCase().includes(archTag));
    if (archDmg) return normalizeAsset(archDmg);
    if (dmgs.length > 0) return normalizeAsset(dmgs[0]);

    const macZips = usable.filter((a) => {
      const n = a.name.toLowerCase();
      return n.endsWith('.zip') && (n.includes('mac') || n.includes('darwin') || n.includes(archTag));
    });
    const archZip = macZips.find((a) => a.name.toLowerCase().includes(archTag));
    if (archZip) return normalizeAsset(archZip);
    if (macZips.length > 0) return normalizeAsset(macZips[0]);
    return null;
  }

  if (platform === 'win32') {
    const exes = usable.filter((a) => a.name.toLowerCase().endsWith('.exe'));
    if (exes.length === 0) return null;
    const isPortableRuntime = Boolean(env && env.PORTABLE_EXECUTABLE_FILE);
    if (isPortableRuntime) {
      const portableExe =
        exes.find((a) => a.name.toLowerCase().includes('portable')) ||
        exes.find((a) => !a.name.toLowerCase().includes('setup'));
      if (portableExe) return normalizeAsset(portableExe);
    }
    const setupExe = exes.find((a) => a.name.toLowerCase().includes('setup'));
    if (setupExe) return normalizeAsset(setupExe);
    return normalizeAsset(exes[0]);
  }

  if (platform === 'linux') {
    const appImages = usable.filter((a) => a.name.toLowerCase().endsWith('.appimage'));
    const debs = usable.filter((a) => a.name.toLowerCase().endsWith('.deb'));
    const isAppImageRuntime = Boolean(env && env.APPIMAGE);
    if (isAppImageRuntime) {
      if (appImages.length > 0) return normalizeAsset(appImages[0]);
      if (debs.length > 0) return normalizeAsset(debs[0]);
    } else {
      if (debs.length > 0) return normalizeAsset(debs[0]);
      if (appImages.length > 0) return normalizeAsset(appImages[0]);
    }
    return null;
  }

  return null;
}

function hasNativeAutoUpdaterMetadata(
  assets,
  { platform = process.platform, env = process.env } = {}
) {
  if (!Array.isArray(assets) || assets.length === 0) return false;
  const names = assets.map((a) => String((a && a.name) || '').toLowerCase());

  if (platform === 'darwin') {
    return names.includes('latest-mac.yml') && names.some((n) => n.endsWith('.zip'));
  }
  if (platform === 'win32') {
    if (env && env.PORTABLE_EXECUTABLE_FILE) return false;
    return names.includes('latest.yml') && names.some((n) => n.endsWith('.exe'));
  }
  if (platform === 'linux') {
    if (!env || !env.APPIMAGE) return false;
    return names.includes('latest-linux.yml') && names.some((n) => n.endsWith('.appimage'));
  }
  return false;
}

function setMockReleaseData(data) {
  mockReleaseData = data || null;
  downloadedViaAutoUpdater = false;
}

function getLastUpdateState() {
  return { ...lastUpdateState };
}

function updateState(patch, onStatus) {
  lastUpdateState = {
    ...lastUpdateState,
    ...patch
  };
  if (typeof onStatus === 'function') {
    try {
      onStatus({ ...lastUpdateState });
    } catch (_) {}
  }
  return { ...lastUpdateState };
}

async function fetchLatestGitHubRelease({ userAgent = 'TheySay-Updater' } = {}) {
  if (mockReleaseData) {
    if (mockReleaseData.error) {
      throw new Error(mockReleaseData.error);
    }
    return mockReleaseData;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function checkForUpdates({
  currentVersion = '1.0.0',
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  isPackaged = false,
  userAgent = 'TheySay-Updater',
  onStatus
} = {}) {
  const normCurrent = normalizeVersionString(currentVersion) || '1.0.0';
  updateState(
    {
      state: 'checking',
      currentVersion: normCurrent,
      error: null
    },
    onStatus
  );

  try {
    const release = await fetchLatestGitHubRelease({ userAgent });
    const rawTag = (release && (release.tag_name || release.tagName || release.version)) || '';
    const latestVersion = normalizeVersionString(rawTag) || normCurrent;
    const updateAvailable = isNewerVersion(latestVersion, normCurrent);
    const assets = Array.isArray(release && release.assets) ? release.assets : [];
    const asset = selectPlatformReleaseAsset(assets, { platform, arch, env });
    const canNativeAutoUpdate = Boolean(
      isPackaged &&
        !mockReleaseData &&
        hasNativeAutoUpdaterMetadata(assets, { platform, env })
    );

    const next = updateState(
      {
        state: updateAvailable ? 'available' : 'up-to-date',
        currentVersion: normCurrent,
        latestVersion,
        updateAvailable,
        releaseName: (release && (release.name || release.releaseName)) || `v${latestVersion}`,
        releaseNotes: (release && (release.body || release.releaseNotes)) || '',
        htmlUrl: (release && (release.html_url || release.htmlUrl)) || GITHUB_RELEASES_URL,
        publishedAt: (release && (release.published_at || release.publishedAt)) || null,
        asset,
        canNativeAutoUpdate,
        percent: 0,
        downloadedPath: null,
        mode: null,
        error: null
      },
      onStatus
    );
    return { ok: true, ...next };
  } catch (err) {
    const errMsg = (err && err.message) || 'Failed to check for updates';
    const next = updateState(
      {
        state: 'error',
        currentVersion: normCurrent,
        error: errMsg
      },
      onStatus
    );
    return { ok: false, ...next };
  }
}

async function tryNativeAutoUpdaterDownload({ version, onStatus }) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (process.platform === 'win32') {
    autoUpdater.verifyUpdateCodeSignature = false;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      autoUpdater.removeListener('download-progress', onProgress);
      autoUpdater.removeListener('update-downloaded', onDownloaded);
      autoUpdater.removeListener('error', onError);
    };

    const onProgress = (prog) => {
      const pct = prog && typeof prog.percent === 'number' ? Math.round(prog.percent) : 0;
      updateState(
        {
          state: 'downloading',
          percent: Math.max(0, Math.min(100, pct))
        },
        onStatus
      );
    };

    const onDownloaded = () => {
      if (settled) return;
      settled = true;
      cleanup();
      downloadedViaAutoUpdater = true;
      const next = updateState(
        {
          state: 'downloaded',
          percent: 100,
          mode: 'native'
        },
        onStatus
      );
      resolve({ ok: true, ...next });
    };

    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err || new Error('electron-updater failed'));
    };

    autoUpdater.on('download-progress', onProgress);
    autoUpdater.on('update-downloaded', onDownloaded);
    autoUpdater.on('error', onError);

    autoUpdater
      .checkForUpdates()
      .then(() => autoUpdater.downloadUpdate())
      .catch(onError);
  });
}

async function downloadReleaseAssetFile({ asset, tempDir, userAgent = 'TheySay-Updater', onStatus }) {
  if (!asset || !asset.url) {
    throw new Error('No platform installer asset available for download');
  }

  const updateDir = path.join(tempDir, 'theysay-updates');
  fs.mkdirSync(updateDir, { recursive: true });
  const safeFileName = path.basename(asset.name || 'TheySay-Update.bin');
  const destPath = path.join(updateDir, safeFileName);

  updateState({ state: 'downloading', percent: 0, error: null }, onStatus);

  const res = await fetch(asset.url, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/octet-stream, */*'
    }
  });
  if (!res.ok || !res.body) {
    throw new Error(`Asset download HTTP ${res.status}`);
  }

  const totalBytes = Number(res.headers.get('content-length')) || asset.size || 0;
  let receivedBytes = 0;
  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const buf = Buffer.from(value);
        fileStream.write(buf);
        receivedBytes += buf.length;
        const pct =
          totalBytes > 0
            ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
            : 50;
        updateState({ state: 'downloading', percent: pct }, onStatus);
      }
    }
  } finally {
    await new Promise((resolve) => fileStream.end(resolve));
  }

  if (process.platform === 'linux' && safeFileName.toLowerCase().endsWith('.appimage')) {
    try {
      fs.chmodSync(destPath, 0o755);
    } catch (_) {}
  }

  downloadedViaAutoUpdater = false;
  const next = updateState(
    {
      state: 'downloaded',
      percent: 100,
      downloadedPath: destPath,
      mode: 'installer'
    },
    onStatus
  );
  return { ok: true, ...next };
}

async function downloadUpdate({
  app,
  shell,
  isPackaged = false,
  userAgent = 'TheySay-Updater',
  onStatus
} = {}) {
  if (activeDownloadPromise) {
    return activeDownloadPromise;
  }

  activeDownloadPromise = (async () => {
    try {
      if (!lastUpdateState.updateAvailable) {
        const checkRes = await checkForUpdates({
          currentVersion: app ? app.getVersion() : lastUpdateState.currentVersion,
          isPackaged,
          userAgent,
          onStatus
        });
        if (!checkRes.ok || !checkRes.updateAvailable) {
          return checkRes;
        }
      }

      if (mockReleaseData) {
        updateState({ state: 'downloading', percent: 45, error: null }, onStatus);
        await new Promise((r) => setTimeout(r, 40));
        const tempDir = app ? app.getPath('temp') : require('os').tmpdir();
        const updateDir = path.join(tempDir, 'theysay-updates');
        fs.mkdirSync(updateDir, { recursive: true });
        const assetName =
          (lastUpdateState.asset && lastUpdateState.asset.name) ||
          `TheySay-${lastUpdateState.latestVersion || '1.1.0'}.mock`;
        const mockPath = path.join(updateDir, path.basename(assetName));
        fs.writeFileSync(mockPath, `mock-installer-${lastUpdateState.latestVersion}`, 'utf8');
        downloadedViaAutoUpdater = false;
        const next = updateState(
          {
            state: 'downloaded',
            percent: 100,
            downloadedPath: mockPath,
            mode: 'mock'
          },
          onStatus
        );
        return { ok: true, ...next };
      }

      if (lastUpdateState.canNativeAutoUpdate && isPackaged) {
        try {
          return await tryNativeAutoUpdaterDownload({
            version: lastUpdateState.latestVersion,
            onStatus
          });
        } catch (nativeErr) {
          console.warn(
            '[Updater] Native electron-updater failed, falling back to direct release asset download:',
            nativeErr.message
          );
        }
      }

      if (lastUpdateState.asset && lastUpdateState.asset.url) {
        const tempDir = app ? app.getPath('temp') : require('os').tmpdir();
        return await downloadReleaseAssetFile({
          asset: lastUpdateState.asset,
          tempDir,
          userAgent,
          onStatus
        });
      }

      if (shell && typeof shell.openExternal === 'function') {
        await shell.openExternal(lastUpdateState.htmlUrl || GITHUB_RELEASES_URL);
      }
      const next = updateState({ state: 'opened-browser', mode: 'browser' }, onStatus);
      return { ok: true, ...next };
    } catch (err) {
      const next = updateState(
        {
          state: 'error',
          error: (err && err.message) || 'Download failed'
        },
        onStatus
      );
      return { ok: false, ...next };
    } finally {
      activeDownloadPromise = null;
    }
  })();

  return activeDownloadPromise;
}

async function applyDownloadedUpdate({ app, shell, onStatus } = {}) {
  try {
    if (mockReleaseData) {
      const next = updateState(
        {
          state: 'installed',
          mode: 'mock'
        },
        onStatus
      );
      return { ok: true, ...next };
    }

    if (downloadedViaAutoUpdater) {
      const { autoUpdater } = require('electron-updater');
      updateState({ state: 'installing', mode: 'native' }, onStatus);
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
      });
      return { ok: true, state: 'installing', mode: 'native' };
    }

    const filePath = lastUpdateState.downloadedPath;
    if (filePath && fs.existsSync(filePath)) {
      if (
        process.platform === 'linux' &&
        process.env.APPIMAGE &&
        filePath.toLowerCase().endsWith('.appimage')
      ) {
        try {
          fs.copyFileSync(filePath, process.env.APPIMAGE);
          fs.chmodSync(process.env.APPIMAGE, 0o755);
          updateState({ state: 'installing', mode: 'appimage' }, onStatus);
          if (app) {
            setImmediate(() => {
              app.relaunch();
              app.exit(0);
            });
          }
          return { ok: true, state: 'installing', mode: 'appimage' };
        } catch (_) {}
      }

      if (shell && typeof shell.openPath === 'function') {
        const openErr = await shell.openPath(filePath);
        if (openErr && typeof shell.showItemInFolder === 'function') {
          shell.showItemInFolder(filePath);
        }
      }

      updateState({ state: 'installing', mode: 'installer' }, onStatus);

      if (process.platform === 'win32' && filePath.toLowerCase().endsWith('.exe') && app) {
        setTimeout(() => {
          app.quit();
        }, 600);
      }

      return { ok: true, state: 'installing', mode: 'installer', downloadedPath: filePath };
    }

    if (shell && typeof shell.openExternal === 'function') {
      await shell.openExternal(lastUpdateState.htmlUrl || GITHUB_RELEASES_URL);
    }
    return { ok: true, state: 'opened-browser', mode: 'browser' };
  } catch (err) {
    const next = updateState(
      {
        state: 'error',
        error: (err && err.message) || 'Failed to apply update'
      },
      onStatus
    );
    return { ok: false, ...next };
  }
}

module.exports = {
  GITHUB_RELEASES_URL,
  normalizeVersionString,
  isNewerVersion,
  isVersionNewer: isNewerVersion,
  selectPlatformReleaseAsset,
  hasNativeAutoUpdaterMetadata,
  setMockReleaseData,
  getLastUpdateState,
  checkForUpdates,
  downloadUpdate,
  applyDownloadedUpdate
};
