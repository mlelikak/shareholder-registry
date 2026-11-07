// Estate flow (DESIGN.md section 7b), for the fictional shareholder Erik.
//
// 1. Notice: Erik's helper Jonas reports the death in the app.
// 2. Protect: Jonas's own key freezes Erik's record (`freeze_holder`). The
//    chain shows only "frozen", never why. All payouts to Erik are held.
// 3. Guide: the caretaker agent writes Jonas a short, kind note on what
//    happens next (NEAR AI Cloud, attested enclave).
// 4. Prepare: the agent reads the SIMULATED estate documents in the enclave
//    and prepares a case for the human reviewer. Only a hash of its summary
//    goes on-chain (`log_agent_action`).
// 5. Decide: the human estate reviewer approves the transfer
//    (`approve_transfer`, reviewer key only, frozen holders only).
// 6. Pay: the estate's account collects the held money (`claim`).

import { createHash, randomBytes } from 'node:crypto';
import { call, relayedCall, signerAccount, txLink, view, type CallResult } from './near.ts';
import { chat, type ReplyProof } from './nearai.ts';
import { BANNED, numbersMatch, parseJson } from './agent/run.ts';
import { addToInbox, appendAgentLog, loadDeployment, readJsonFile, writeJsonFile, type CastMember, type Deployment } from './store.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newId = () => randomBytes(6).toString('hex');

export type EstateCase = {
  representative: string;
  documents: string[];
  missing: string[];
  estateAccount: string;
  /** Checked by code, not by the AI: the account in the documents is the estate account on file. */
  accountMatches: boolean;
  summary: string;
  summaryHash: string;
  logTx?: string;
  proof?: ReplyProof;
  at: string;
};

type EstateFile = {
  reportedBy?: string;
  reportedAt?: string;
  freezeTx?: string;
  case?: EstateCase;
  approveTx?: string;
  collectTx?: string;
};

const load = () => readJsonFile<EstateFile>('estate.json', {});
const save = (patch: Partial<EstateFile>) => writeJsonFile('estate.json', { ...load(), ...patch });

const result = (r: CallResult, okMessage: string) => ({ ok: r.ok, message: r.ok ? okMessage : 'Refused', error: r.error, explorer: txLink(r.txHash) });

function erik(d: Deployment): CastMember {
  const m = d.cast.find((c) => c.key === 'erik');
  if (!m) throw new Error('This demo copy has no Erik');
  return m;
}

/** Simulated estate documents. Fictional people; nothing here goes on-chain. */
export function simulatedDocuments(d: Deployment): string {
  const estate = d.estate?.accountId ?? '(no estate account in this demo copy)';
  return `DOCUMENT 1 – Death certificate (simulated)
Name of the deceased: Erik (fictional demo shareholder)
Date of death: last week
Issued by: the civil registry

DOCUMENT 2 – Estate inventory (simulated)
Estate of Erik. Assets include ${d.companyName} shares held in the shareholder registry.
Parties to the estate: Jonas (son), Karin (daughter).
Representative of the estate: Jonas, authorised by both parties.

DOCUMENT 3 – Authorisation (simulated)
Jonas and Karin authorise Jonas to receive payments for the estate.
Estate account for payments: ${estate}`;
}

/** Steps 1–3: the helper reports the death; the record is frozen; the agent writes a kind note. */
export async function reportDeath(d: Deployment, helper: CastMember): Promise<{ ok: boolean; message: string; error?: string; explorer?: string; feePaidByPlatform?: boolean }> {
  const of = d.cast.find((c) => c.key === helper.helperOf);
  if (!of) return { ok: false, message: 'Only a helper can do this.' };
  const self = signerAccount(helper.accountId, helper.privateKey);
  const relayer = d.relayer ? signerAccount(d.relayer.accountId, d.relayer.privateKey) : null;
  const args = { holder_id: of.accountId };
  const r = relayer ? await relayedCall(self, relayer, d.registry, 'freeze_holder', args) : await call(self, d.registry, 'freeze_holder', args);
  if (!r.ok) return { ok: false, message: 'That did not go through', error: r.error, explorer: txLink(r.txHash) };
  save({ reportedBy: helper.key, reportedAt: new Date().toISOString(), freezeTx: txLink(r.txHash) });

  const facts = [
    `${helper.name} told us that ${of.name} has died.`,
    `${of.name}'s shareholder record is now protected: nothing can be changed, and any money for ${of.name} is kept safe until the estate is settled.`,
    `Next, the estate's representative sends three documents: the death certificate, the estate inventory, and the authorisation from the estate's parties.`,
    `A person on our team, not a computer, checks them and approves the payment to the estate's account.`,
    `There is no deadline and nothing is lost by waiting.`,
  ];
  let subject = `About ${of.name}'s shares`;
  let body = `Dear ${helper.name}, we are very sorry for your loss. ${facts.slice(1).join(' ')} – Your shareholder service`;
  let proof: ReplyProof | undefined;
  try {
    const reply = await chat(
      [
        {
          role: 'system',
          content:
            'You write for a shareholder service. Write a short, kind email to a family member after a death. Plain words, no pressure, no technical terms, at most 110 words. Use ONLY the facts given; add no numbers or dates. Reply with JSON only: {"subject": string, "body": string}. Sign it "Your shareholder service".',
        },
        { role: 'user', content: `To: ${helper.name}\nFacts:\n- ${facts.join('\n- ')}` },
      ],
      { json: true, maxTokens: 500 },
    );
    proof = reply.proof;
    const j = parseJson(reply.content);
    const s = String(j?.subject ?? '');
    const b = String(j?.body ?? '');
    const text = `${s} ${b}`;
    if (b && !BANNED.test(text) && b.length <= 1200 && numbersMatch(text, facts)) {
      subject = s || subject;
      body = b;
    }
  } catch {
    // Keep the plain fallback note; the freeze has already protected the money.
  }
  addToInbox({ id: newId(), at: new Date().toISOString(), channel: 'email', to: helper.key, toName: helper.name, from: 'agent', subject, body });
  appendAgentLog([
    {
      id: newId(),
      at: new Date().toISOString(),
      runId: 'estate',
      kind: 'chain',
      holder: of.key,
      title: `${helper.name} (helper) froze ${of.name}'s record; the chain shows only "frozen"`,
      txHash: r.txHash,
    },
    { id: newId(), at: new Date().toISOString(), runId: 'estate', kind: 'message', holder: helper.key, title: `Email to ${helper.name}`, detail: body, data: { proof } },
  ]);
  return { ok: true, message: `${of.name}'s record is protected. Nothing can be changed, and money for ${of.name} is kept safe.`, explorer: txLink(r.txHash), feePaidByPlatform: Boolean(r.relayedBy) };
}

/** Step 4: the agent reads the simulated documents inside the enclave and prepares the case. */
export async function prepareCase(d: Deployment = loadDeployment()) {
  const docs = simulatedDocuments(d);
  const reply = await chat(
    [
      {
        role: 'system',
        content:
          'You prepare an estate case for a human reviewer at a shareholder registry. Read the documents. You do not decide anything. Reply with JSON only: {"representative": string, "documents": string[] (which of: death certificate, estate inventory, authorisation are present), "missing": string[], "estate_account": string (copied exactly), "summary": string (2 sentences, plain words, for the reviewer)}.',
      },
      { role: 'user', content: docs },
    ],
    { json: true, maxTokens: 600 },
  );
  const j = parseJson(reply.content) ?? {};
  const estateAccount = String(j.estate_account ?? '').trim();
  const summary = String(j.summary ?? '').trim();
  const c: EstateCase = {
    representative: String(j.representative ?? ''),
    documents: Array.isArray(j.documents) ? j.documents.map(String) : [],
    missing: Array.isArray(j.missing) ? j.missing.map(String) : [],
    estateAccount,
    accountMatches: Boolean(d.estate) && estateAccount === d.estate!.accountId,
    summary,
    summaryHash: sha256(summary),
    proof: reply.proof,
    at: new Date().toISOString(),
  };
  const agent = signerAccount(d.agent.accountId, d.agent.privateKey);
  const r = await call(agent, d.registry, 'log_agent_action', { holder_id: erik(d).accountId, action: 'case_prepared', summary_hash: c.summaryHash });
  c.logTx = txLink(r.txHash);
  save({ case: c });
  appendAgentLog([
    {
      id: newId(),
      at: c.at,
      runId: 'estate',
      kind: 'finding',
      holder: 'erik',
      title: 'Read the estate documents in the enclave and prepared the case for the human reviewer',
      detail: summary,
      summaryHash: c.summaryHash,
      txHash: r.txHash,
      data: { proof: reply.proof, representative: c.representative, documents: c.documents, missing: c.missing, accountMatches: c.accountMatches },
    },
  ]);
  return { ok: true, message: 'The agent prepared the case. Only a fingerprint of its summary is on-chain.', explorer: c.logTx };
}

/** Step 5: the human reviewer approves the transfer to the estate's account. */
export async function approveTransfer(d: Deployment = loadDeployment()) {
  if (!d.estate) return { ok: false, message: 'This demo copy has no estate account; reset the demo.' };
  const reviewer = signerAccount(d.reviewer.accountId, d.reviewer.privateKey);
  const r = await call(reviewer, d.registry, 'approve_transfer', { holder_id: erik(d).accountId, new_account: d.estate.accountId });
  if (r.ok) save({ approveTx: txLink(r.txHash) });
  return result(r, "Approved. Erik's holding and any money kept for him now belong to the estate.");
}

/** Lifts a freeze made by mistake (reviewer only). */
export async function unfreeze(d: Deployment = loadDeployment()) {
  const reviewer = signerAccount(d.reviewer.accountId, d.reviewer.privateKey);
  const r = await call(reviewer, d.registry, 'unfreeze_holder', { holder_id: erik(d).accountId });
  if (r.ok) writeJsonFile('estate.json', {});
  return result(r, "Freeze lifted. Erik's record is active again.");
}

/** Step 6: the estate's account collects the money kept for Erik. */
export async function estateCollects(d: Deployment = loadDeployment()) {
  if (!d.estate) return { ok: false, message: 'This demo copy has no estate account; reset the demo.' };
  const self = signerAccount(d.estate.accountId, d.estate.privateKey);
  const relayer = d.relayer ? signerAccount(d.relayer.accountId, d.relayer.privateKey) : null;
  const args = { company_id: d.companyId, holder_id: erik(d).accountId };
  const r = relayer
    ? await relayedCall(self, relayer, d.registry, 'claim', args, { gasTera: 100 })
    : await call(self, d.registry, 'claim', args, { gasTera: 100 });
  if (r.ok) save({ collectTx: txLink(r.txHash) });
  return result(r, "The estate collected the money kept for Erik.");
}

export async function estateView(d: Deployment = loadDeployment()) {
  const e = erik(d);
  const [holder, held, estateBalance] = await Promise.all([
    view<{ state: string; helpers: string[]; transfer?: { new_account: string } | null } | null>(d.registry, 'get_holder', { holder_id: e.accountId }),
    view<string>(d.registry, 'get_held_funds', { company_id: d.companyId, holder_id: e.accountId }),
    d.estate ? view<string>(d.token, 'ft_balance_of', { account_id: d.estate.accountId }) : Promise.resolve('0'),
  ]);
  const f = load();
  return {
    holder: { name: e.name, accountId: e.accountId, state: holder?.state ?? 'unknown', transferredTo: holder?.transfer?.new_account ?? null },
    helpers: (holder?.helpers ?? []).map((id) => d.cast.find((c) => c.accountId === id)?.name ?? id.slice(0, 8)),
    held,
    estate: d.estate ? { accountId: d.estate.accountId, balance: estateBalance } : null,
    documents: simulatedDocuments(d),
    ...f,
  };
}
