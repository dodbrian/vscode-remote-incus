const esbuild = require('esbuild');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-incus-tests-build-'));
  try {
    const entryPoints = fs.readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().map(name => path.join('tests', name));
    if (!entryPoints.length) throw new Error('No offline test files found in tests/');
    await esbuild.build({
      entryPoints,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      outdir: output,
      outExtension: { '.js': '.cjs' },
      plugins: [{
        name: 'offline-boundaries',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: path.resolve('tests/support/vscode.ts') }));
          build.onResolve({ filter: /^(node:)?(child_process|net|http|https|http2|tls|dns|dgram)(\/promises)?$/ }, args => ({
            path: args.path.replace(/^node:/, ''), namespace: 'offline',
          }));
          build.onLoad({ filter: /.*/, namespace: 'offline' }, args => ({
            contents: `const { boundaryModule } = require(${JSON.stringify(path.resolve('tests/support/fixture.ts'))}); module.exports = boundaryModule(${JSON.stringify(args.path)}, ${JSON.stringify(Object.getOwnPropertyNames(require(`node:${args.path}`)))});`,
            loader: 'js', resolveDir: process.cwd(),
          }));
        },
      }],
    });
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=30000', ...fs.readdirSync(output).filter(name => name.endsWith('.test.cjs')).map(name => path.join(output, name))], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
