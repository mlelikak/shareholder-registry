// The caretaker agent's pass over an open payout event.
//
// 1. Reads the register from the contract.
// 2. Plain code finds what needs attention, spots disputes that cancel out
//    (an unrecorded transfer) and decides the steps (findings.ts).
// 3. The model on NEAR AI Cloud, inside an attested enclave, writes the
//    report, the explanations and the messages. Each reply's signature is
//    checked against the enclave's attestation.
// 4. The agent sends messages to the demo inbox and calls the contract with
//    its restricted key: flag, pause and log only.

import { createHash, randomBytes } from 'node:crypto';
import { call, signerAccount, txLink, view } from '../near.ts';
import { attest, chat, linkProofs, MODEL, type Attestation, type ReplyProof } from '../nearai.ts';
import {
  addToInbox,
  appendAgentLog,
  loadAgentLog,
  type AgentLogEntry,
  type CastMember,
  type Deployment,
} from '../store.ts';
import {
  findIssues,
  plan,
  proposeCorrections,
  summarize,
  type Config,
  type Holder,
  type HolderFinding,
  type Issue,
  type Proposal,
  type ReadinessLine,
  type Step,
} from './findings.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newId = () => randomBytes(6).toString('hex');

/** Words that must never reach an investor: no tech terms, no requests for secrets. */
const BANNED = /\b(wallet|blockchain|crypto|token|seed phrase|private key|password|pin code|near protocol|smart contract|http|www\.)/i;

export type RunResult = {
  runId: string;
  readiness: ReturnType<typeof summarize>;
  findings: (HolderFinding & { name: string })[];
  proposals: (Proposal & { explanation: string })[];
  report: string;
  messages: number;
  chainActions: { method: string; holder: string; ok: boolean; txHash?: string; error?: string }[];
  attestation: Attestation[];
  proofs: ReplyProof[];
};

type MessageRequest = { id: string; to: CastMember; channel: 'email' | 'text' | 'helper'; topics: Issue[]; facts: string[] };

/** Facts in the investor's own terms ("you"), passed to the model word for word. */
const TOPIC_FACTS: Record<string, (f: HolderFinding) => string> = {
  contact_bounced: () => 'Our last email to you could not be delivered, so we are sending a text instead. Your payout is on hold until you confirm your details; your money is safe and waiting for you.',
  kyc_expired: () => 'Your identity check has expired. Please identify again (a few minutes, with your usual identification) so we can pay you.',
  kyc_missing: () => 'You have not completed the identity check yet. Please do it so we can pay you.',
  share_count_disputed: (f) => `You told us you hold ${f.claimedShares} shares; our register says ${f.shares}. We are looking into it and will ask you to confirm once it is corrected.`,
  share_count_unanswered: (f) => `Please check your share count: our register says ${f.shares} shares.`,
  details_stale: () => 'It has been a while since you confirmed your payout details. One tap in the app confirms they are still right.',
  never_confirmed: () => 'You have not confirmed your payout details yet.',
};

function topicFacts(topic: Issue, f: HolderFinding): string {
  return (TOPIC_FACTS[topic] ?? (() => topic))(f);
}

/** On-chain steps already taken for the same issues, so a re-run doesn't repeat them. */
function alreadyActed(): Set<string> {
  return new Set(
    loadAgentLog()
      .filter((e) => e.kind === 'chain')
      .map((e) => (e.data as { key?: string })?.key ?? ''),
  );
}

/** Messages already sent in this deployment, so a re-run doesn't repeat them. */
function alreadySent(): Set<string> {
  return new Set(
    loadAgentLog()
      .filter((e) => e.kind === 'message')
      .flatMap((e) => ((e.data as { topics?: string[] })?.topics ?? []).map((t) => `${e.holder}|${t}`)),
  );
}

/** Every number in a message must come from its facts, so the model can't invent one. */
function numbersMatch(body: string, facts: string[]): boolean {
  const nums = (t: string) => (t.replace(/(d),(d{3})/g, '$1$2').match(/d+/g) ?? []);
  const allowed = new Set(nums(facts.join(' ')));
  return nums(body).every((n) => allowed.has(n));
}

function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function fallbackMessage(r: MessageRequest): { subject?: string; body: string } {
  return {
    subject: r.channel === 'email' ? 'A quick check about your shares' : undefined,
    body: `Hello ${r.to.name}, ${r.facts.join(' ')} Please open the app or call us if anything is unclear. – Your shareholder service`,
  };
}

export async function runAgent(d: Deployment): Promise<RunResult> {
  const runId = newId();
  const now = Date.now();
  const log: AgentLogEntry[] = [];
  const entry = (e: Omit<AgentLogEntry, 'id' | 'at' | 'runId'>) => {
    const full = { id: newId(), at: new Date().toISOString(), runId, ...e };
    log.push(full);
    return full;
  };
  const byAccount = new Map(d.cast.map((c) => [c.accountId, c]));
  const nameOf = (id: string) => byAccount.get(id)?.name ?? id.slice(0, 8);

  // 1. Read the register.
  const config = await view<Config>(d.registry, 'get_config');
  const lines = await view<ReadinessLine[]>(d.registry, 'get_readiness', { event_id: d.eventId });
  const findings: (HolderFinding & { name: string })[] = [];
  for (const line of lines) {
    const holder = await view<Holder | null>(d.registry, 'get_holder', { holder_id: line.holder_id });
    findings.push({ ...findIssues(line, holder, config, now), name: nameOf(line.holder_id) });
  }

  // 2. Plain code decides what needs doing.
  const readiness = summarize(findings);
  const proposals = proposeCorrections(findings);
  const sent = alreadySent();
  const steps = new Map<string, Step[]>(findings.map((f) => [f.holderId, plan(f)]));
  const requests: MessageRequest[] = [];
  // One message per person per run, covering everything new for them.
  for (const f of findings) {
    const member = byAccount.get(f.holderId);
    if (!member) continue;
    const fresh = steps.get(f.holderId)!.filter(
      (s): s is Extract<Step, { kind: 'message' }> => s.kind === 'message' && !sent.has(`${member.key}|${s.topic}`),
    );
    if (!fresh.length) continue;
    requests.push({
      id: `m${requests.length + 1}`,
      to: member,
      channel: fresh.some((s) => s.channel === 'text') ? 'text' : 'email',
      topics: fresh.map((s) => s.topic),
      facts: fresh.map((s) => topicFacts(s.topic, f)),
    });
  }

  // 3. The enclave model writes the words.
  const briefing = {
    company: d.companyName,
    readiness: { ready: readiness.ready, total: readiness.total, ...readiness.counts },
    holders: findings.map((f) => ({
      name: f.name,
      register_shares: f.shares,
      said_they_hold: f.claimedShares ?? null,
      status: f.status,
      ready: f.ready,
      issues: f.issues,
    })),
    possible_unrecorded_transfers: proposals.map((p, i) => ({
      id: `p${i + 1}`,
      pattern: p.pattern,
      corrections: p.corrections.map((c) => ({ name: nameOf(c.holder_id), corrected_shares: c.shares })),
    })),
    messages_to_write: requests.map((r) => ({ id: r.id, to: r.to.name, channel: r.channel, facts: r.facts })),
  };
  const system = [
    `You are the caretaker agent of a shareholder registry. ${d.companyName} is being sold and is about to pay its shareholders.`,
    'You never decide amounts or share counts, and you never move money. Code has already worked out the facts; you explain them.',
    'Reply with JSON only, shaped as {"report": string, "proposals": [{"id": string, "explanation": string}], "messages": [{"id": string, "subject": string|null, "body": string}]}.',
    'report: 2-4 plain sentences for the company admin on payout readiness, naming who needs what next.',
    'proposals: for each possible unrecorded transfer, 1-2 sentences on why the numbers suggest one transfer the register missed, and that the admin applies the correction and both holders confirm it.',
    'messages: one per item in messages_to_write. Readers are often older and not technical: short sentences, warm, calm, no pressure, no deadlines.',
    'Each message covers all of its facts, in that order. Keep every fact exactly as given (same channel, same numbers); you may only make the wording warmer and plainer. Never invent numbers, dates or amounts.',
    'Texts under 320 characters, no subject. Emails under 140 words with a short subject.',
    'Never mention wallets, blockchain, crypto, tokens or technology. Never ask for passwords, codes, or bank details. Tell them to open the app or call us. Sign off as "Your shareholder service".',
  ].join('\n');
  const proofs: ReplyProof[] = [];
  let report = `${readiness.ready} of ${readiness.total} ready.`;
  const explanations = new Map<string, string>();
  const written = new Map<string, { subject?: string; body: string }>();
  try {
    // The model occasionally returns something that isn't JSON; one retry fixes it.
    let reply = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(briefing) },
      ],
      { json: true, maxTokens: 4000 },
    );
    proofs.push(reply.proof);
    let parsed = parseJson(reply.content);
    if (!parsed) {
      entry({ kind: 'error', title: 'The AI reply was not valid JSON; asking once more', detail: `stop reason ${reply.finishReason}: ${reply.content.slice(0, 200)}` });
      reply = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(briefing) },
        ],
        { json: true, maxTokens: 4000 },
      );
      proofs.push(reply.proof);
      parsed = parseJson(reply.content);
    }
    if (!parsed) throw new Error(`the model did not return JSON (stop reason ${reply.finishReason}, usage ${JSON.stringify(reply.usage)}): ${reply.content.slice(0, 300)}`);
    if (typeof parsed.report === 'string') report = parsed.report;
    for (const p of (parsed.proposals as { id: string; explanation: string }[]) ?? []) explanations.set(p.id, p.explanation);
    for (const m of (parsed.messages as { id: string; subject: string | null; body: string }[]) ?? []) {
      written.set(m.id, { subject: m.subject ?? undefined, body: m.body });
    }
  } catch (e) {
    entry({ kind: 'error', title: 'The AI step failed; using plain templates', detail: String((e as Error).message ?? e) });
  }

  // Check the enclave's attestation once per run and link each reply to it.
  let attestation: Attestation[] = [];
  try {
    attestation = await attest();
    linkProofs(proofs, attestation);
    const a = attestation.find((x) => x.keyInQuote) ?? attestation[0];
    entry({
      kind: 'attestation',
      title: proofs.every((p) => p.attested)
        ? `AI replies signed inside an attested Intel TDX enclave (${MODEL})`
        : 'Could not link every AI reply to the attested enclave',
      detail: a
        ? `Enclave key ${a.signingAddress}. Fresh nonce ${a.nonce.slice(0, 16)}… and the key are inside the Intel TDX quote (v${a.quoteVersion}, TEE type ${a.teeType}); NVIDIA GPU evidence ${a.nvidiaEvidence ? 'present' : 'missing'}.`
        : 'No attestation returned.',
      data: { attestation, proofs },
    });
  } catch (e) {
    entry({ kind: 'error', title: 'Attestation check failed', detail: String((e as Error).message ?? e) });
  }

  entry({
    kind: 'report',
    title: `Readiness: ${readiness.ready} of ${readiness.total} ready`,
    detail: report,
    data: { readiness, model: MODEL },
  });

  // 4. Act: messages to the demo inbox, then the restricted on-chain calls.
  const agent = signerAccount(d.agent.accountId, d.agent.privateKey);
  const chainActions: RunResult['chainActions'] = [];
  const acted = alreadyActed();
  const onChain = async (method: string, holder: CastMember | undefined, holderId: string, args: Record<string, unknown>, title: string, detail: string, key: string) => {
    if (acted.has(key)) return null;
    const r = await call(agent, d.registry, method, args);
    chainActions.push({ method, holder: nameOf(holderId), ok: r.ok, txHash: r.txHash, error: r.error });
    entry({
      kind: r.ok ? 'chain' : 'error',
      holder: holder?.key,
      title: r.ok ? title : `${title}: failed`,
      detail: r.ok ? detail : r.error,
      summaryHash: (args.summary_hash ?? args.reason_hash) as string | undefined,
      txHash: r.txHash,
      data: { method, key },
    });
    return r;
  };

  let messages = 0;
  for (const r of requests) {
    let text = written.get(r.id) ?? fallbackMessage(r);
    const checks = [!BANNED.test(`${text.subject ?? ''} ${text.body}`), text.body.length <= 1200, numbersMatch(`${text.subject ?? ''} ${text.body}`, r.facts)];
    if (checks.includes(false)) {
      entry({ kind: 'error', holder: r.to.key, title: `AI message to ${r.to.name} failed a safety check; sent the plain version`, detail: text.body });
      text = fallbackMessage(r);
    }
    addToInbox({
      id: newId(),
      at: new Date().toISOString(),
      channel: r.channel,
      to: r.to.key,
      toName: r.to.name,
      subject: r.channel === 'email' ? text.subject : undefined,
      body: text.body,
      from: 'agent',
    });
    messages++;
    entry({
      kind: 'message',
      holder: r.to.key,
      title: `${r.channel === 'text' ? 'Text' : r.channel === 'email' ? 'Email' : 'Helper alert'} to ${r.to.name}`,
      detail: text.body,
      data: { topics: r.topics, channel: r.channel },
    });
  }

  for (const f of findings) {
    const member = byAccount.get(f.holderId);
    const todo = steps.get(f.holderId)!;
    // Reasons stay off-chain. The hash includes the run id, so a short reason
    // can't be guessed back from the chain.
    const reason = `${runId}|${member?.key}|${f.issues.join(',')}`;
    if (todo.some((s) => s.kind === 'pause')) {
      await onChain('pause_holder', member, f.holderId, { holder_id: f.holderId, reason_hash: sha256(reason) },
        `Paused ${f.name}'s payouts until they are back in touch`, reason, `${f.holderId}|pause|${f.issues.join(',')}`);
    }
    if (todo.some((s) => s.kind === 'flag')) {
      await onChain('flag_holder', member, f.holderId, { holder_id: f.holderId, reason_hash: sha256(reason) },
        `Flagged ${f.name} for the company`, reason, `${f.holderId}|flag|${f.issues.join(',')}`);
    }
    const did = todo.map((s) => (s.kind === 'message' ? `${s.channel}:${s.topic}` : s.kind));
    if (did.length) {
      const summary = `${runId}|${member?.key}|${did.join(',')}`;
      await onChain('log_agent_action', member, f.holderId, { holder_id: f.holderId, action: 'caretaker_pass', summary_hash: sha256(summary) },
        `Logged what it did for ${f.name}`, summary, `${f.holderId}|log|${did.join(',')}`);
    }
  }

  const explained = proposals.map((p, i) => ({ ...p, explanation: explanations.get(`p${i + 1}`) ?? `The disputes cancel out (${p.pattern}), which suggests one share transfer the register never recorded.` }));
  for (const p of explained) {
    const names = p.corrections.map((c) => `${nameOf(c.holder_id)} → ${c.shares}`).join(', ');
    const summary = `${runId}|proposal|${JSON.stringify(p.corrections)}`;
    const first = p.corrections[0].holder_id;
    const done = await onChain('log_agent_action', byAccount.get(first), first, { holder_id: first, action: 'correction_proposed', summary_hash: sha256(summary) },
      `Proposed a correction: ${names}`, summary, `proposal|${JSON.stringify(p.corrections)}`);
    if (done === null) continue; // proposed in an earlier run
    entry({ kind: 'proposal', title: `Possible unrecorded transfer (${p.pattern}): ${names}`, detail: p.explanation, data: { corrections: p.corrections, status: 'proposed' } });
  }

  appendAgentLog(log);
  return { runId, readiness, findings, proposals: explained, report, messages, chainActions, attestation, proofs };
}

export { txLink };
