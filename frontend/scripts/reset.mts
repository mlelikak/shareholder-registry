// Reset demo: recycles the current demo copy (its test NEAR goes back to the
// funder) and seeds a fresh one with new dates under the next suffix.
// Testnet only, test tokens only.
//
// Usage (from frontend/): node scripts/reset.mts
// A stopped reset resumes from .demo/reset.json when run again.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recycleDeployment } from '../src/server/recycle.ts';
import type { Deployment } from '../src/server/store.ts';

const DEMO = join(import.meta.dirname, '..', '.demo');
const STATUS = join(DEMO, 'reset.json');

type Status = { from: string; to: string; funder: string; phase: 'recycling' | 'seeding' | 'done' | 'failed'; startedAt: string; endedAt?: string };
const save = (s: Status) => writeFileSync(STATUS, JSON.stringify(s, null, 2));

const deployment = JSON.parse(readFileSync(join(DEMO, 'deployment.json'), 'utf8')) as Deployment;
const suffixOf = (registryId: string) => registryId.split('.')[0].replace(/^reg-/, '');

let status: Status | null = existsSync(STATUS) ? JSON.parse(readFileSync(STATUS, 'utf8')) : null;
if (!status || status.phase === 'done') {
  const from = suffixOf(deployment.registry);
  const m = from.match(/^(\D*)(\d+)$/);
  const to = m ? `${m[1]}${Number(m[2]) + 1}` : `${from}1`;
  status = { from, to, funder: deployment.funder, phase: 'recycling', startedAt: new Date().toISOString() };
  save(status);
}
console.log(`== Reset demo: ${status.from} -> ${status.to} (funder ${status.funder})`);

if (status.phase === 'recycling' || status.phase === 'failed') {
  status.phase = 'recycling';
  save(status);
  const oldKeys = join(DEMO, `keys-${status.from}.json`);
  // Copies listed in .demo/keep.json (e.g. ["d13"]) are never deleted: the README's
  // "Verify it on-chain" links point at them. Their deployment record is kept beside it.
  const keepFile = join(DEMO, 'keep.json');
  const keep: string[] = existsSync(keepFile) ? JSON.parse(readFileSync(keepFile, 'utf8')) : [];
  if (suffixOf(deployment.registry) === status.from && keep.includes(status.from)) {
    writeFileSync(join(DEMO, `deployment-${status.from}.json`), JSON.stringify(deployment, null, 2));
    console.log(`== keep ${status.from}: listed in keep.json, not recycled`);
  } else if (suffixOf(deployment.registry) === status.from) {
    const saved: Record<string, string> = existsSync(oldKeys) ? JSON.parse(readFileSync(oldKeys, 'utf8')) : {};
    const contractKeys: Record<string, string> = {};
    if (saved.reg) contractKeys[deployment.registry] = saved.reg;
    if (saved.teur) contractKeys[deployment.token] = saved.teur;
    console.log('== recycle the old copy');
    const failures = await recycleDeployment(deployment, contractKeys);
    if (failures) console.log(`note  ${failures} account(s) could not be deleted; continuing`);
  }
  status.phase = 'seeding';
  save(status);
}

console.log(`== seed ${status.to}`);
const r = spawnSync(process.execPath, [join(import.meta.dirname, 'seed.mts'), status.to, status.funder], { stdio: 'inherit' });
if (r.status !== 0) {
  status.phase = 'failed';
  save(status);
  console.error('\nReset stopped. Run it again to continue.');
  process.exit(1);
}
status.phase = 'done';
status.endedAt = new Date().toISOString();
save(status);
console.log('\nReset done.');
