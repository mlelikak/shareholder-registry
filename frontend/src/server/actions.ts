// Button actions for the company and demo screens. Each is one contract call
// signed with the key of the role that is allowed to make it.

import { randomBytes } from 'node:crypto';
import { call, signerAccount, txLink, type CallResult } from './near.ts';
import { appendAgentLog, loadAgentLog, loadDeployment, type Deployment } from './store.ts';
import { latestProposals } from './state.ts';

export type ActionResult = { ok: boolean; message: string; error?: string; txHash?: string; explorer?: string };

const asResult = (r: CallResult, okMessage: string): ActionResult => ({
  ok: r.ok,
  message: r.ok ? okMessage : 'Refused',
  error: r.error,
  txHash: r.txHash,
  explorer: txLink(r.txHash),
});

const admin = (d: Deployment) => signerAccount(d.admin.accountId, d.admin.privateKey);

/** The company admin applies the agent's proposed correction. */
export async function applyProposal(proposalId: string): Promise<ActionResult> {
  const d = loadDeployment();
  const p = latestProposals(loadAgentLog()).find((x) => x.id === proposalId);
  if (!p) return { ok: false, message: 'No such proposal' };
  if (p.status === 'applied') return { ok: false, message: 'Already applied' };
  const r = await call(admin(d), d.registry, 'resolve_dispute', { event_id: d.eventId, corrections: p.corrections });
  if (r.ok) {
    appendAgentLog([
      {
        id: randomBytes(6).toString('hex'),
        at: new Date().toISOString(),
        runId: 'admin',
        kind: 'chain',
        title: 'Company admin applied the correction; both holders must confirm again',
        detail: p.title,
        txHash: r.txHash,
        data: { appliedProposal: p.id },
      },
    ]);
  }
  return asResult(r, 'Correction applied. Both holders now confirm the new numbers.');
}

export async function runPayout(): Promise<ActionResult> {
  const d = loadDeployment();
  const r = await call(admin(d), d.registry, 'execute_payout', { event_id: d.eventId }, { gasTera: 300 });
  return asResult(r, 'Exit payout run. Every line is now paid, queued or held.');
}

export async function simulateBounce(holderKey: string): Promise<ActionResult> {
  const d = loadDeployment();
  const h = d.cast.find((c) => c.key === holderKey);
  if (!h) return { ok: false, message: 'Unknown holder' };
  const r = await call(admin(d), d.registry, 'mark_contact_bounced', { company_id: d.companyId, holder_id: h.accountId });
  return asResult(r, `${h.name}'s email marked as bounced (simulated).`);
}

/**
 * Attacker panel. "outsider": an unrelated account tries to change Maria's
 * payout account. "insider": the company's own admin tries the same.
 * Both are refused by the contract: only Maria can change her details.
 */
export async function attackerTry(who: 'outsider' | 'insider'): Promise<ActionResult> {
  const d = loadDeployment();
  const maria = d.cast.find((c) => c.key === 'maria')!;
  const signer =
    who === 'insider' ? admin(d) : d.attacker ? signerAccount(d.attacker.accountId, d.attacker.privateKey) : null;
  if (!signer) return { ok: false, message: 'This demo copy has no attacker account; re-seed to add one.' };
  const r = await call(signer, d.registry, 'request_payout_change', {
    holder_id: maria.accountId,
    method: 'near',
    new_account: signer.accountId,
  });
  return asResult(r, 'WARNING: the change was accepted. This must never happen.');
}
