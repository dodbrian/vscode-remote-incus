import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { withFixture } from './support/fixture';

// Isolate the manual helper from the offline process proxy. Replace its native
// process methods with stubs: no daemon, process spawn or network is exercised.
const hostRequire = createRequire(process.cwd() + '/package.json');
test('manual metrics restore hooks on success/failure, identify failed samples and preserve exact phase totals', (t) =>
  withFixture(t, async (f) => {
    const file = `${f.directory}/metrics.cjs`;
    hostRequire('esbuild').buildSync({
      entryPoints: ['scripts/startup-metrics.ts'],
      bundle: true,
      platform: 'node',
      outfile: file,
    });
    const cp = hostRequire('node:child_process') as typeof import('node:child_process');
    const originalExec = cp.execFile;
    const originalSpawn = cp.spawn;
    const execStub = (() => undefined) as unknown as typeof cp.execFile;
    const spawnStub = (() => undefined) as unknown as typeof cp.spawn;
    cp.execFile = execStub;
    cp.spawn = spawnStub;
    try {
      const { measureStartup } = hostRequire(file) as typeof import('../scripts/startup-metrics');
      assert.equal(cp.execFile, execStub, 'import must not install hooks');
      assert.equal(cp.spawn, spawnStub);
      const payload = `${f.directory}/private-payload`;
      writeFileSync(payload, 'abc');
      const samples: any[] = [];
      const output = (line: string): void => {
        assert.ok(!line.includes(payload) && !line.includes('private-target'));
        samples.push(JSON.parse(line.slice('METRIC '.length)));
      };
      const result = await measureStartup(
        'success',
        async () => {
          cp.execFile('incus', ['exec', 'private-target']);
          cp.execFile('unrelated', []);
          cp.spawn('incus', ['file', 'push', payload, 'private-target']);
          measureStartup.phase('prepared');
          measureStartup.phase('30% transfer');
          await assert.rejects(
            measureStartup('nested', async () => {}, output),
            /nested measurement/,
          );
          return 42;
        },
        output,
      );
      assert.equal(result, 42);
      assert.equal(cp.execFile, execStub);
      assert.equal(cp.spawn, spawnStub);
      assert.deepEqual(
        [samples[0].outcome, samples[0].execs, samples[0].pushes, samples[0].bytes],
        ['success', 1, 1, 3],
      );
      assert.deepEqual(
        samples[0].phases.map((p: any) => p.phase),
        ['prepared', 'end'],
      );
      const failure = new Error('fixture failure');
      await assert.rejects(
        measureStartup(
          'failed',
          () => {
            throw failure;
          },
          output,
        ),
        (error) => error === failure,
      );
      assert.equal(samples[1].outcome, 'failure');
      assert.equal(cp.execFile, execStub);
      assert.equal(cp.spawn, spawnStub);
      for (const s of samples)
        assert.equal(
          s.phases.reduce((total: number, p: any) => total + Number(p.ms), 0),
          s.ms,
        );
      await assert.rejects(
        measureStartup(
          'output failure',
          async () => {},
          () => {
            throw failure;
          },
        ),
        (error) => error === failure,
      );
      assert.equal(cp.execFile, execStub);
      assert.equal(cp.spawn, spawnStub);
    } finally {
      cp.execFile = originalExec;
      cp.spawn = originalSpawn;
      // Standard cache invalidation — require.cache deletion is the API for it.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete hostRequire.cache[file];
    }
  }));
