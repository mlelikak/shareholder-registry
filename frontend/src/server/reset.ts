// Starts scripts/reset.mts in the background and reports its progress, so the
// Reset demo button survives page reloads. Testnet only.

import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = /*turbopackIgnore: true*/ process.cwd();
const DIR = process.env.DEMO_DIR ?? join(ROOT, '.demo');
const LOG = join(DIR, 'reset.log');
const PID = join(DIR, 'reset.pid');
const STATUS = join(DIR, 'reset.json');

export type ResetStatus = {
  running: boolean;
  phase?: 'recycling' | 'seeding' | 'done' | 'failed';
  from?: string;
  to?: string;
  startedAt?: string;
  endedAt?: string;
  log: string[];
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resetRunning(): boolean {
  if (!existsSync(PID)) return false;
  const pid = Number(readFileSync(PID, 'utf8'));
  return Number.isFinite(pid) && pid > 0 && alive(pid);
}

export function resetStatus(): ResetStatus {
  const s = existsSync(STATUS) ? (JSON.parse(readFileSync(STATUS, 'utf8')) as Omit<ResetStatus, 'running' | 'log'>) : {};
  const running = resetRunning();
  const log = existsSync(LOG) ? readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean).slice(-14) : [];
  // A reset that was killed mid-way still says "seeding"; show it as stopped.
  const phase = !running && (s.phase === 'recycling' || s.phase === 'seeding') ? 'failed' : s.phase;
  return { ...s, phase, running, log };
}

export function startReset(): { ok: boolean; message: string } {
  if (resetRunning()) return { ok: false, message: 'A reset is already running.' };
  const out = openSync(LOG, 'w');
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'reset.mts')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  closeSync(out);
  writeFileSync(PID, String(child.pid ?? 0));
  child.unref();
  return { ok: true, message: 'Reset started. It takes a few minutes.' };
}
