const path = require('path');
const esbuild = require('esbuild');

async function buildUI() {
  const entryPoint = path.join(__dirname, '..', 'src', 'ui', 'mantine-shell.jsx');
  const outfile = path.join(__dirname, '..', 'src', 'ui', 'dist', 'mantine-shell.js');

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: ['chrome130'],
    jsx: 'automatic',
    external: ['electron'],
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    logLevel: 'info'
  });
}

buildUI().catch((err) => {
  console.error('[build-ui] Failed to build Mantine UI bundle:', err);
  process.exit(1);
});
