// Build script (standard vscode extension esbuild pattern, adapted).
//   node esbuild.js              development bundle + sourcemaps
//   node esbuild.js --production minified, no sourcemaps (packaging)
//   node esbuild.js --watch      incremental watch mode
const esbuild = require('esbuild');
const fs = require('node:fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // A prior development build may have left a sourcemap beside the bundle.
  if (production) fs.rmSync('dist/extension.js.map', { force: true });
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
