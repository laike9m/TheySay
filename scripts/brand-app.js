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

  // 1. Update Info.plist names
  if (fs.existsSync(infoPlist)) {
    try {
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName TheySay" "${infoPlist}"`, { stdio: 'ignore' });
    } catch (_) {}
    try {
      execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName TheySay" "${infoPlist}"`, { stdio: 'ignore' });
    } catch (_) {}
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
  }
}

try {
  brandApp();
} catch (err) {
  console.warn('brand-app warning:', err.message);
}
