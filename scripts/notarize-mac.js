const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_KEYCHAIN_PROFILE = process.env.NOTARY_KEYCHAIN_PROFILE || 'notarize-app';

function hasDeveloperIdCert() {
  try {
    const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' });
    return out.includes('Developer ID Application');
  } catch (_) {
    return false;
  }
}

function isAlreadyStapled(dmgPath) {
  try {
    execFileSync('xcrun', ['stapler', 'validate', dmgPath], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function notarizeDmg(dmgPath, keychainProfile = DEFAULT_KEYCHAIN_PROFILE) {
  if (!fs.existsSync(dmgPath)) {
    throw new Error(`DMG not found: ${dmgPath}`);
  }

  if (isAlreadyStapled(dmgPath)) {
    console.log(`[Notarize] ${path.basename(dmgPath)} is already notarized and stapled; skipping.`);
    return;
  }

  console.log(`\n[Notarize] Submitting ${path.basename(dmgPath)} with keychain profile "${keychainProfile}"...`);
  execFileSync(
    'xcrun',
    ['notarytool', 'submit', '--wait', '--keychain-profile', keychainProfile, dmgPath],
    { stdio: 'inherit' }
  );
  console.log('✅ [Notarize] Notarization succeeded');

  console.log(`[Notarize] Stapling ticket to ${path.basename(dmgPath)}...`);
  execFileSync('xcrun', ['stapler', 'staple', dmgPath], { stdio: 'inherit' });

  console.log(`[Notarize] Validating stapled ticket on ${path.basename(dmgPath)}...`);
  execFileSync('xcrun', ['stapler', 'validate', dmgPath], { stdio: 'inherit' });
  console.log(`✅ [Notarize] Validation succeeded for ${path.basename(dmgPath)}\n`);
}

module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') {
    return [];
  }
  if (
    process.env.THEYSAY_SKIP_NOTARIZE === '1' ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false'
  ) {
    console.log('[Notarize] Skipping notarization (THEYSAY_SKIP_NOTARIZE=1 or unsigned build).');
    return [];
  }
  if (!hasDeveloperIdCert()) {
    console.log('[Notarize] No "Developer ID Application" certificate found in Keychain; skipping notarization.');
    return [];
  }

  const artifactPaths = Array.isArray(buildResult && buildResult.artifactPaths)
    ? buildResult.artifactPaths
    : [];
  const dmgFiles = artifactPaths.filter((p) => typeof p === 'string' && p.endsWith('.dmg'));

  for (const dmgPath of dmgFiles) {
    notarizeDmg(dmgPath);
  }

  return [];
};

if (require.main === module) {
  const distDir = path.join(__dirname, '..', 'dist');
  const dmgs = fs.existsSync(distDir)
    ? fs
        .readdirSync(distDir)
        .filter((f) => f.endsWith('.dmg'))
        .map((f) => path.join(distDir, f))
    : [];
  if (dmgs.length === 0) {
    console.error('No .dmg files found in dist/');
    process.exit(1);
  }
  for (const dmg of dmgs) {
    notarizeDmg(dmg);
  }
}
