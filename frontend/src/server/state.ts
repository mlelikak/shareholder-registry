// Everything the screens show, read from the contract, plus the off-chain
// demo pieces. Never includes private keys.

import { loadDeliveries, type Delivery } from './payout-service.ts';
import { view, accountLink, EXPLORER } from './near.ts';
import { loadAgentLog, loadDeployment, loadInbox, type AgentLogEntry, type Deployment } from './store.ts';
import { findIssues, summarize, type Config, type Holder, type HolderFinding, type ReadinessLine } from './agent/findings.ts';

type Company = { name: string; admin: string; payout_token: string; total_shares: number; holdings: Record<string, number>; open_event: string | null };
type Line = { shares: number; amount: string; outcome: string };
type PayoutView = {
  event: {
    company_id: string;
    total: string;
    record_date: number;
    snapshot: Record<string, number>;
    confirmations: Record<string, unknown>;
    funded: string;
    state: 'preparing' | 'funded' | 'executed';
    manifest_root: string | null;
    remainder: string;
    lines: Record<string, Line>;
  };
  totals: { paid: string; queued: string; held: string; in_flight: string; remainder: string };
};

export type HolderView = HolderFinding & {
  key: string;
  name: string;
  accountId: string;
  explorer: string;
  confirmation: ReadinessLine['confirmation'];
  payoutMethod?: string;
  holderState?: string;
  helpers: string[];
  line?: Line;
  held: string;
};

export type Check = { label: string; ok: boolean; detail: string };

export type Proposal = {
  id: string;
  at: string;
  title: string;
  explanation: string;
  corrections: { holder_id: string; shares: number }[];
  status: 'proposed' | 'applied';
  applyTx?: string;
};

export type DemoState = {
  network: 'testnet';
  explorer: string;
  registry: { id: string; explorer: string };
  token: string;
  agent: { id: string; explorer: string; allowedMethods: string[] };
  company: { id: string; name: string; totalShares: number; admin: string };
  event: {
    id: string;
    state: string;
    total: string;
    funded: string;
    recordDate: number;
    manifestRoot: string | null;
    totals: PayoutView['totals'];
  } | null;
  config: Config;
  readiness: ReturnType<typeof summarize>;
  holders: HolderView[];
  helper: { key: string; name: string; accountId: string; helperOf?: string } | null;
  checks: Check[];
  proposals: Proposal[];
  inboxCount: number;
  /** Intents deliveries by the payout service (delivery simulated, quote real). */
  deliveries: Delivery[];
  seededAt: string;
  now: number;
};

export function latestProposals(log: AgentLogEntry[]): Proposal[] {
  const applied = new Map<string, string | undefined>();
  for (const e of log) {
    const d = e.data as { appliedProposal?: string } | undefined;
    if (d?.appliedProposal) applied.set(d.appliedProposal, e.txHash);
  }
  return log
    .filter((e) => e.kind === 'proposal')
    .map((e) => {
      const d = e.data as { corrections: Proposal['corrections'] };
      return {
        id: e.id,
        at: e.at,
        title: e.title,
        explanation: e.detail ?? '',
        corrections: d.corrections,
        status: applied.has(e.id) ? 'applied' : 'proposed',
        applyTx: applied.get(e.id),
      } as Proposal;
    });
}

export async function readState(d: Deployment = loadDeployment()): Promise<DemoState> {
  const now = Date.now();
  const [config, company, payout] = await Promise.all([
    view<Config>(d.registry, 'get_config'),
    view<Company | null>(d.registry, 'get_company', { company_id: d.companyId }),
    view<PayoutView | null>(d.registry, 'get_payout', { event_id: d.eventId }),
  ]);
  const lines = payout ? await view<ReadinessLine[]>(d.registry, 'get_readiness', { event_id: d.eventId }) : [];
  const holders: HolderView[] = [];
  for (const line of lines) {
    const member = d.cast.find((c) => c.accountId === line.holder_id);
    const [h, held] = await Promise.all([
      view<(Holder & { payout_method: string }) | null>(d.registry, 'get_holder', { holder_id: line.holder_id }),
      view<string>(d.registry, 'get_held_funds', { company_id: d.companyId, holder_id: line.holder_id }),
    ]);
    holders.push({
      ...findIssues(line, h, config, now),
      key: member?.key ?? line.holder_id,
      name: member?.name ?? line.holder_id.slice(0, 8),
      accountId: line.holder_id,
      explorer: accountLink(line.holder_id),
      confirmation: line.confirmation,
      payoutMethod: h?.payout_method,
      holderState: h?.state,
      helpers: (h?.helpers ?? []).map((id) => d.cast.find((c) => c.accountId === id)?.name ?? id.slice(0, 8)),
      line: payout?.event.lines[line.holder_id],
      held,
    });
  }
  const order = ['maria', 'tom', 'peter', 'lena', 'erik'];
  holders.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  const snapshotSum = payout ? Object.values(payout.event.snapshot).reduce((s, n) => s + n, 0) : 0;
  const disputes = holders.filter((h) => h.claimedShares !== undefined).length;
  const checks: Check[] = payout
    ? [
        {
          label: 'Holdings add up to the company total',
          ok: snapshotSum === company?.total_shares,
          detail: `${snapshotSum.toLocaleString('en')} of ${company?.total_shares.toLocaleString('en')} shares`,
        },
        {
          label: 'Funded with exactly the payout total',
          ok: payout.event.funded === payout.event.total,
          detail: payout.event.funded === payout.event.total ? 'exact amount received' : 'waiting for funding',
        },
        {
          label: 'No share counts in dispute',
          ok: disputes === 0,
          detail: disputes === 0 ? 'none open' : `${disputes} open`,
        },
        {
          label: 'Amounts calculated by the contract, not by AI',
          ok: true,
          detail: 'integer arithmetic at payout time; rounding remainder kept for the company',
        },
      ]
    : [];

  const helper = d.cast.find((c) => c.helperOf) ?? null;
  return {
    network: 'testnet',
    explorer: EXPLORER,
    registry: { id: d.registry, explorer: accountLink(d.registry) },
    token: d.token,
    agent: { id: d.agent.accountId, explorer: accountLink(d.agent.accountId), allowedMethods: d.agent.allowedMethods },
    company: { id: d.companyId, name: d.companyName, totalShares: company?.total_shares ?? 0, admin: d.admin.accountId },
    event: payout
      ? {
          id: d.eventId,
          state: payout.event.state,
          total: payout.event.total,
          funded: payout.event.funded,
          recordDate: payout.event.record_date,
          manifestRoot: payout.event.manifest_root,
          totals: payout.totals,
        }
      : null,
    config,
    readiness: summarize(holders),
    holders,
    helper: helper ? { key: helper.key, name: helper.name, accountId: helper.accountId, helperOf: helper.helperOf } : null,
    checks,
    proposals: latestProposals(loadAgentLog()),
    inboxCount: loadInbox().length,
    deliveries: loadDeliveries(),
    seededAt: d.createdAt,
    now,
  };
}
