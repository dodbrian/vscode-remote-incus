/** Manual harness instrumentation. Never records argv, stdout, tokens or targets. */
import * as fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const cp = require('node:child_process') as typeof import('node:child_process');
let active: {
  started: number; elapsedMs: number; execs: number; pushes: number; bytes: number;
  phases: { phase: string; ms: number }[];
} | undefined;

export async function measureStartup<T>(scenario: string, run: () => Promise<T>, output: (line: string) => void): Promise<T> {
  if (active) throw new Error('nested measurement');
  const originalExec = cp.execFile;
  const originalSpawn = cp.spawn;
  active = { started: performance.now(), elapsedMs: 0, execs: 0, pushes: 0, bytes: 0, phases: [] };
  cp.execFile = ((...args: any[]) => {
    if (active && args[0] === 'incus') active.execs++;
    return (originalExec as any)(...args);
  }) as typeof cp.execFile;
  cp.spawn = ((...args: any[]) => {
    if (active && args[0] === 'incus' && args[1]?.[0] === 'file' && args[1]?.[1] === 'push') {
      active.pushes++;
      active.bytes += fs.statSync(args[1][2]).size;
    }
    return (originalSpawn as any)(...args);
  }) as typeof cp.spawn;
  let outcome = 'failure';
  try {
    const result = await run();
    outcome = 'success';
    return result;
  } finally {
    measureStartup.phase('end');
    const { started: _started, elapsedMs, ...metrics } = active;
    active = undefined;
    cp.execFile = originalExec;
    cp.spawn = originalSpawn;
    output('METRIC ' + JSON.stringify({ scenario, outcome, ms: elapsedMs, ...metrics }));
  }
}
measureStartup.phase = (phase: string) => {
  if (!active || /^\d+%/.test(phase)) return;
  // Round the cumulative clock, then subtract: phase totals equal wall time.
  const elapsedMs = Math.round(performance.now() - active.started);
  active.phases.push({ phase, ms: elapsedMs - active.elapsedMs });
  active.elapsedMs = elapsedMs;
};
