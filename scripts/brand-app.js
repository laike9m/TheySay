const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function brandApp() {
  if (process.platform !== 'darwin') {
    return;
  }

  const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
  const distDir = path.join(electronDir, 'dist');
  const pathTxt = path.join(electronDir, 'path.txt');
  const iconSrc = path.join(__dirname, '..', 'assets', 'icon.icns');

  if (!fs.existsSync(distDir)) {
    return;
  }

  const electronApp = path.join(distDir, 'Electron.app');
  const theySayApp = path.join(distDir, 'TheySay.app');

  // Rename Electron.app to TheySay.app if it exists
  if (fs.existsSync(electronApp) && !fs.existsSync(theySayApp)) {
    fs.renameSync(electronApp, theySayApp);
  }

  const targetApp = fs.existsSync(theySayApp) ? theySayApp : electronApp;
  if (!fs.existsSync(targetApp)) {
    return;
  }

  const infoPlist = path.join(targetApp, 'Contents', 'Info.plist');
  const resourcesDir = path.join(targetApp, 'Contents', 'Resources');

  const pkgPath = path.join(__dirname, '..', 'package.json');
  let bundleId = 'com.laike9m.theysay';
  let appDisplayName = 'TheySay';
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.appId) bundleId = pkg.appId;
      if (pkg.productName) appDisplayName = pkg.productName;
    } catch (_) {}
  }

  const setPlistKey = (plistPath, key, type, value) => {
    if (!fs.existsSync(plistPath)) return;
    try {
      execSync(`/usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${plistPath}"`, { stdio: 'ignore' });
    } catch (_) {
      try {
        execSync(`/usr/libexec/PlistBuddy -c "Add :${key} ${type} ${value}" "${plistPath}"`, { stdio: 'ignore' });
      } catch (__) {}
    }
  };

  // 1. Update Info.plist names, bundle identifier & Continuity Camera key
  if (fs.existsSync(infoPlist)) {
    setPlistKey(infoPlist, 'CFBundleName', 'string', appDisplayName);
    setPlistKey(infoPlist, 'CFBundleDisplayName', 'string', appDisplayName);
    setPlistKey(infoPlist, 'CFBundleIdentifier', 'string', bundleId);
    setPlistKey(infoPlist, 'NSCameraUseContinuityCameraDeviceType', 'bool', 'true');
  }

  // 1b. Also add NSCameraUseContinuityCameraDeviceType to Electron Helper Info.plist bundles
  // so Chromium's video capture utility process does not trigger the macOS AVFoundation warning
  const frameworksDir = path.join(targetApp, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworksDir)) {
    const helperApps = [
      'Electron Helper.app',
      'Electron Helper (GPU).app',
      'Electron Helper (Plugin).app',
      'Electron Helper (Renderer).app'
    ];
    for (const helper of helperApps) {
      const helperPlist = path.join(frameworksDir, helper, 'Contents', 'Info.plist');
      setPlistKey(helperPlist, 'NSCameraUseContinuityCameraDeviceType', 'bool', 'true');
    }
  }

  // 2. Replace application icon
  if (fs.existsSync(iconSrc) && fs.existsSync(resourcesDir)) {
    try {
      fs.copyFileSync(iconSrc, path.join(resourcesDir, 'electron.icns'));
    } catch (_) {}
  }

  // 3. Update path.txt so Electron CLI launches TheySay.app (without trailing newline!)
  if (fs.existsSync(theySayApp)) {
    fs.writeFileSync(pathTxt, 'TheySay.app/Contents/MacOS/Electron', 'utf8');

    // 4. Ad-hoc re-sign bundle for macOS
    try {
      execSync(`codesign --force --deep -s - "${theySayApp}"`, { stdio: 'ignore' });
    } catch (_) {}

    // 5. Touch bundle to invalidate macOS cache
    try {
      execSync(`touch "${theySayApp}"`, { stdio: 'ignore' });
    } catch (_) {}

    // 6. Refresh LaunchServices database so macOS and Manico recognize the new bundle ID immediately
    try {
      execSync(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${theySayApp}"`, { stdio: 'ignore' });
    } catch (_) {}
  }
}

try {
  brandApp();
} catch (err) {
  console.warn('brand-app warning:', err.message);
}
