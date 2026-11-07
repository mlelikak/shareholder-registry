// Recycles a demo copy: deletes each of its testnet accounts and sends the
// remaining test NEAR back to the funder, so Reset demo costs almost nothing.
// Testnet only. The agent account cannot be deleted (it holds only a
// restricted key, by design), so its small balance stays behind.

import { actions } from 'near-api-js';
import { accountExists, pause, send, signerAccount } from './near.ts';
import type { Deployment, KeyedAccount } from './store.ts';

/** `contractKeys` maps the registry and token account IDs to their full-access keys (from the seed's keys file). */
export async function recycleDeployment(
  d: Deployment,
  contractKeys: Record<string, string>,
  log: (line: string) => void = console.log,
): Promise<number> {
  const accounts: (KeyedAccount & { label: string })[] = [
    ...d.cast.map((c) => ({ ...c, label: `${c.name}'s account` })),
    { ...d.admin, label: 'company admin' },
    { ...d.kyc, label: 'KYC provider' },
    { ...d.verifier, label: 'bank verifier' },
    { ...d.reviewer, label: 'estate reviewer' },
    { ...d.payoutService, label: 'payout service' },
    ...(d.attacker ? [{ ...d.attacker, label: 'attacker' }] : []),
    // Contracts last, after everyone who has a balance on them is gone.
    { accountId: d.registry, privateKey: '', label: 'registry contract' },
    { accountId: d.token, privateKey: '', label: 'test euro token' },
  ];
  const keys = new Map<string, string>();
  for (const a of accounts) if (a.privateKey) keys.set(a.accountId, a.privateKey);

  let failures = 0;
  for (const a of accounts) {
    const key = keys.get(a.accountId) ?? contractKeys[a.accountId];
    if (!(await accountExists(a.accountId))) {
      log(`gone  ${a.label}`);
      continue;
    }
    if (!key) {
      log(`skip  ${a.label}: no key saved`);
      continue;
    }
    const r = await send(signerAccount(a.accountId, key), a.accountId, [actions.deleteAccount(d.funder)], `delete ${a.label}`);
    // A retried send can report "does not exist" after the first try already
    // deleted it, so trust the chain rather than the message.
    if (r.ok || !(await accountExists(a.accountId))) log(`ok    ${a.label} deleted, test NEAR returned`);
    else {
      log(`FAIL  ${a.label}: ${r.error}`);
      failures++;
    }
    await pause(300);
  }
  return failures;
}
