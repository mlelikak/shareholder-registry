// What needs attention before a payout, worked out by plain code from the
// contract's own data. No AI here: the AI only explains these findings and
// writes the messages (see run.ts).

export type Status = 'green' | 'amber' | 'red';
export type Confirmation = 'unconfirmed' | 'confirmed' | { disputed: { shares: number } };

export type Holder = {
  payout_method: 'near' | 'intents' | 'bank';
  pending_change: { method: string; effective_at: number; extended: boolean } | null;
  helpers: string[];
  last_confirmed_at: number | null;
  contact_status: 'ok' | 'bounced';
  contact_changed_at: number | null;
  kyc_valid_until: number | null;
  screening: 'clear' | 'review';
  state: 'active' | 'paused' | 'frozen' | 'transferred';
};

export type ReadinessLine = {
  holder_id: string;
  shares: number;
  confirmation: Confirmation;
  status: Status;
  ready: boolean;
};

export type Config = { stale_after_ms: number };

export type Issue =
  | 'contact_bounced'
  | 'kyc_expired'
  | 'kyc_missing'
  | 'kyc_expiring'
  | 'screening_review'
  | 'never_confirmed'
  | 'details_stale'
  | 'share_count_unanswered'
  | 'share_count_disputed'
  | 'change_waiting'
  | 'paused'
  | 'frozen';

export type HolderFinding = {
  holderId: string;
  shares: number;
  status: Status;
  ready: boolean;
  issues: Issue[];
  /** Number the holder gave, if they disputed the register. */
  claimedShares?: number;
  changeEffectiveAt?: number;
  changeExtended?: boolean;
};

export type Correction = { holder_id: string; shares: number };

export type Proposal = {
  corrections: Correction[];
  /** Plain description of the pattern, written by code, e.g. "-200 / +200". */
  pattern: string;
  totalUnchanged: boolean;
};

export type Readiness = {
  total: number;
  ready: number;
  counts: Record<'stale' | 'unreachable' | 'disputed' | 'kyc' | 'unanswered' | 'paused_or_frozen', number>;
};

export function findIssues(line: ReadinessLine, holder: Holder | null, config: Config, now: number): HolderFinding {
  const issues: Issue[] = [];
  const f: HolderFinding = { holderId: line.holder_id, shares: line.shares, status: line.status, ready: line.ready, issues };
  if (!holder) {
    issues.push('never_confirmed');
    return f;
  }
  if (holder.contact_status === 'bounced') issues.push('contact_bounced');
  if (holder.kyc_valid_until === null) issues.push('kyc_missing');
  else if (holder.kyc_valid_until <= now) issues.push('kyc_expired');
  else if (holder.kyc_valid_until - now <= config.stale_after_ms) issues.push('kyc_expiring');
  if (holder.screening === 'review') issues.push('screening_review');
  if (holder.last_confirmed_at === null) issues.push('never_confirmed');
  else if (now - holder.last_confirmed_at > config.stale_after_ms) issues.push('details_stale');
  if (line.confirmation === 'unconfirmed') issues.push('share_count_unanswered');
  if (typeof line.confirmation === 'object' && 'disputed' in line.confirmation) {
    issues.push('share_count_disputed');
    f.claimedShares = line.confirmation.disputed.shares;
  }
  if (holder.pending_change) {
    issues.push('change_waiting');
    f.changeEffectiveAt = holder.pending_change.effective_at;
    f.changeExtended = holder.pending_change.extended;
  }
  if (holder.state === 'paused') issues.push('paused');
  if (holder.state === 'frozen') issues.push('frozen');
  return f;
}

export function summarize(findings: HolderFinding[]): Readiness {
  const has = (f: HolderFinding, ...i: Issue[]) => i.some((x) => f.issues.includes(x));
  return {
    total: findings.length,
    ready: findings.filter((f) => f.ready).length,
    counts: {
      stale: findings.filter((f) => has(f, 'details_stale', 'never_confirmed')).length,
      unreachable: findings.filter((f) => has(f, 'contact_bounced')).length,
      disputed: findings.filter((f) => has(f, 'share_count_disputed')).length,
      kyc: findings.filter((f) => has(f, 'kyc_expired', 'kyc_missing', 'screening_review')).length,
      unanswered: findings.filter((f) => has(f, 'share_count_unanswered')).length,
      paused_or_frozen: findings.filter((f) => has(f, 'paused', 'frozen')).length,
    },
  };
}

/**
 * Looks for disputes that cancel out, which usually means a share transfer the
 * register never recorded: one holder N short, another N over. Pairs first,
 * then all open disputes together. The proposal only ever uses numbers the
 * holders themselves gave, and must keep the company's total unchanged.
 */
export function proposeCorrections(findings: HolderFinding[]): Proposal[] {
  const disputes = findings
    .filter((f) => f.claimedShares !== undefined)
    .map((f) => ({ f, delta: f.claimedShares! - f.shares }));
  const proposals: Proposal[] = [];
  const used = new Set<string>();
  for (let i = 0; i < disputes.length; i++) {
    for (let j = i + 1; j < disputes.length; j++) {
      const a = disputes[i];
      const b = disputes[j];
      if (used.has(a.f.holderId) || used.has(b.f.holderId)) continue;
      if (a.delta !== 0 && a.delta + b.delta === 0) {
        used.add(a.f.holderId);
        used.add(b.f.holderId);
        const short = a.delta < 0 ? a : b;
        const over = a.delta < 0 ? b : a;
        proposals.push({
          corrections: [
            { holder_id: short.f.holderId, shares: short.f.claimedShares! },
            { holder_id: over.f.holderId, shares: over.f.claimedShares! },
          ],
          pattern: `${short.delta} / +${over.delta}`,
          totalUnchanged: true,
        });
      }
    }
  }
  const rest = disputes.filter((d) => !used.has(d.f.holderId));
  if (rest.length > 2 && rest.reduce((s, d) => s + d.delta, 0) === 0) {
    proposals.push({
      corrections: rest.map((d) => ({ holder_id: d.f.holderId, shares: d.f.claimedShares! })),
      pattern: rest.map((d) => (d.delta > 0 ? `+${d.delta}` : `${d.delta}`)).join(' / '),
      totalUnchanged: true,
    });
  }
  return proposals;
}

/** What the agent does about each issue: decided by rules, not by the AI. */
export type Step =
  | { kind: 'message'; channel: 'email' | 'text' | 'helper'; topic: Issue }
  | { kind: 'pause' }
  | { kind: 'flag' };

export function plan(f: HolderFinding): Step[] {
  const steps: Step[] = [];
  const has = (i: Issue) => f.issues.includes(i);
  // Email doesn't reach a bounced holder, so go to a text message, and pause
  // the record so nothing changes until they are back in touch.
  const channel: 'email' | 'text' = has('contact_bounced') ? 'text' : 'email';
  if (has('contact_bounced')) {
    steps.push({ kind: 'message', channel: 'text', topic: 'contact_bounced' });
    if (!has('paused') && !has('frozen')) steps.push({ kind: 'pause' });
  }
  if (has('kyc_expired') || has('kyc_missing')) steps.push({ kind: 'message', channel, topic: has('kyc_expired') ? 'kyc_expired' : 'kyc_missing' }, { kind: 'flag' });
  if (has('screening_review')) steps.push({ kind: 'flag' });
  if (has('share_count_disputed')) steps.push({ kind: 'message', channel, topic: 'share_count_disputed' }, { kind: 'flag' });
  else if (has('share_count_unanswered') && !has('contact_bounced')) steps.push({ kind: 'message', channel, topic: 'share_count_unanswered' });
  if ((has('details_stale') || has('never_confirmed')) && !has('contact_bounced')) steps.push({ kind: 'message', channel, topic: has('never_confirmed') ? 'never_confirmed' : 'details_stale' });
  // Only one flag per holder per run.
  return steps.filter((s, i) => s.kind !== 'flag' || steps.findIndex((x) => x.kind === 'flag') === i);
}
