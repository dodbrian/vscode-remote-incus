import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { childProcess, withFixture } from './support/fixture';
import { pushFile } from '../src/incusCli';

test('B6 defect: in-flight stat must not report after push completes', t => withFixture(t, async f => {
  const file = `${f.directory}/archive`; writeFileSync(file, Buffer.alloc(100));
  let child!: ReturnType<typeof childProcess>; let finishStat!: (...args: any[]) => void;
  f.expect('child_process.spawn', () => child = childProcess());
  f.expect('child_process.execFile', (_cmd, _args, _opts, cb) => { finishStat = cb; });
  const reports: number[] = [];
  const pending = pushFile({ remote: 'offline', instance: 'same' }, file, '/tmp/archive', { onProgress: p => reports.push(p) });
  child.emit('close', 0); await pending;
  finishStat(null, '80', ''); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(reports, [], 'late stat result must be ignored once transfer settles');
}));
