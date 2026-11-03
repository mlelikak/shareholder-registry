'use client';

import Link from 'next/link';
import type { AgentLogEntry } from '@/server/store.ts';
import { Avatar, euros, Icon, ISSUE_TEXT, Loading, Reply, sortIssues, Spinner, StatusPill, useAction, usePoll, type DemoState } from '@/app/ui';

const OUTCOME: Record<string, { text: string; cls: string }> = {
  paid: { text: 'Paid', cls: 'green' },
  in_flight: { text: 'Sending', cls: 'accent' },
  queued: { text: 'Queued for bank', cls: 'accent' },
  held: { text: 'Held for them', cls: 'amber' },
  awaiting_route: { text: 'Cross-chain pending', cls: 'accent' },
  released: { text: 'Cross-chain sending', cls: 'accent' },
  settling: { text: 'Settling', cls: 'accent' },
};
const PAY_VIA: Record<string, string> = { near: 'Own account', bank: 'Bank', intents: 'Other chain' };

function nextStep(s: DemoState, agentRan: boolean): string {
  if (s.event?.state === 'executed') return 'Payout done. Held shareholders can collect their money from the investor app once they are back.';
  const proposed = s.proposals.find((p) => p.status === 'proposed');
  if (!agentRan) return 'Run the caretaker agent: it checks every shareholder and contacts the ones who need to act.';
  if (proposed) return 'Review the agent’s proposed correction and apply it if it looks right.';
  const unconfirmed = s.holders.filter((h) => h.issues.includes('share_count_unanswered') && !h.issues.includes('contact_bounced'));
  if (s.checks.some((c) => !c.ok)) return 'Waiting for shareholders to answer. Open the investor app to answer as them.';
  if (unconfirmed.length) return `All checks pass. ${unconfirmed.map((h) => h.name).join(' and ')} still need to confirm in the investor app, or their share will be held.`;
  return 'All checks pass. Run the exit payout: anyone not ready is held, never lost.';
}

export default function CompanyPage() {
  const state = usePoll<DemoState>('/api/state');
  const log = usePoll<AgentLogEntry[]>('/api/agent-log', 8000);
  const { running, reply, run } = useAction(() => {
    state.refresh();
    log.refresh();
  });
  const s = state.data;
  if (!s) return <main><Loading error={state.error} /></main>;

  const report = log.data?.find((e) => e.kind === 'report');
  const attestation = log.data?.find((e) => e.kind === 'attestation');
  const executed = s.event?.state === 'executed';
  const allChecks = s.checks.every((c) => c.ok);
  const busy = Boolean(running);
  const counts = { green: 0, amber: 0, red: 0 } as Record<string, number>;
  s.holders.forEach((h) => (counts[h.status] += 1));

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="eyebrow">Company · {s.company.name}</div>
          <h1>Exit payout</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            {s.company.name} has been sold. The caretaker agent makes sure every shareholder is verified, reachable and agrees with their
            share count. The contract calculates every amount and refuses to pay if a check fails.
          </p>
        </div>
      </div>

      <div className="split">
        <div className="stack-lg">
          <section className="card">
            <div className="row">
              <div>
                <div className="big-num">
                  {s.readiness.ready}
                  <span className="muted" style={{ fontSize: 24, fontWeight: 600 }}> of {s.readiness.total}</span>
                </div>
                <div className="muted">shareholders ready to be paid</div>
              </div>
              <div className="spacer" />
              <div className="legend">
                <span><span className="dot" style={{ color: 'var(--green)' }} /> {counts.green} current</span>
                <span><span className="dot" style={{ color: 'var(--amber)' }} /> {counts.amber} need a look</span>
                <span><span className="dot" style={{ color: 'var(--red)' }} /> {counts.red} need action</span>
              </div>
            </div>
            <div className="readiness">
              {s.holders.map((h) => (
                <div key={h.accountId} className={`seg ${h.ready ? 'green' : h.status}`} title={`${h.name}: ${h.ready ? 'ready' : 'not ready'}`} />
              ))}
            </div>
            <div className="next-step">
              <Icon name="arrow" className="" />
              <div><b>Next step:</b> {nextStep(s, Boolean(report))}</div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="card-icon"><Icon name="users" /></div>
              <div>
                <h2>Register</h2>
                <div className="small muted">Names are shown only here, off-chain. On-chain each shareholder is a random account.</div>
              </div>
            </div>
            <div className="register">
              <div className="reg-row head">
                <div>Shareholder</div>
                <div className="col-shares">Shares</div>
                <div>Status</div>
                <div className="col-pay">{executed ? 'Payout' : 'Paid to'}</div>
              </div>
              {s.holders.map((h) => {
                const issues = sortIssues(h.issues);
                return (
                  <div key={h.accountId} className="reg-row">
                    <div className="who">
                      <Avatar name={h.name} />
                      <div style={{ minWidth: 0 }}>
                        <div className="name">{h.name}</div>
                        <a href={h.explorer} target="_blank" rel="noreferrer" title="Their random on-chain account">{h.accountId.slice(0, 12)}…</a>
                      </div>
                    </div>
                    <div className="col-shares">
                      <div style={{ fontWeight: 600 }}>{h.shares.toLocaleString('en')}</div>
                      {h.claimedShares !== undefined ? (
                        <div className="tiny" style={{ color: 'var(--red)', fontWeight: 600 }}>says {h.claimedShares.toLocaleString('en')}</div>
                      ) : h.confirmation === 'confirmed' ? (
                        <div className="tiny muted">confirmed ✓</div>
                      ) : null}
                    </div>
                    <div>
                      {h.ready ? <span className="pill green"><span className="dot" />Ready</span> : <StatusPill status={h.status} />}
                      {issues.length > 0 && (
                        <div className="reason" style={{ marginTop: 4 }}>
                          {ISSUE_TEXT[issues[0]] ?? issues[0]}
                          {issues.length > 1 && <span className="more" title={issues.slice(1).map((i) => ISSUE_TEXT[i] ?? i).join(', ')}> · +{issues.length - 1} more</span>}
                        </div>
                      )}
                    </div>
                    <div className="col-pay">
                      {executed && h.line ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{euros(h.line.amount)}</div>
                          <span className={`pill ${OUTCOME[h.line.outcome]?.cls ?? 'neutral'}`}>{OUTCOME[h.line.outcome]?.text ?? h.line.outcome}</span>
                        </>
                      ) : (
                        <span className="small">{PAY_VIA[h.payoutMethod ?? ''] ?? '–'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {!executed && (
              <div className="row small" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
                <span className="muted">Demo: simulate an email bouncing for</span>
                {s.holders.filter((h) => !h.issues.includes('contact_bounced')).map((h) => (
                  <button key={h.key} className="btn ghost small" disabled={busy} onClick={() => run(`Bounce ${h.name}`, 'bounce', { holder: h.key })}>
                    {h.name}
                  </button>
                ))}
              </div>
            )}
            <Reply reply={reply?.label.startsWith('Bounce') ? reply : null} />
          </section>
        </div>

        <div className="stack-lg">
          <section className="card agent-card">
            <div className="card-head">
              <div className="card-icon dark" style={{ background: 'rgba(255,255,255,0.12)' }}><Icon name="bot" /></div>
              <div>
                <h2>Caretaker agent</h2>
                <span className="enclave-badge"><Icon name="lock" /> Private AI on NEAR AI Cloud</span>
              </div>
            </div>
            {report ? (
              <p className="agent-report">{report.detail}</p>
            ) : (
              <p className="muted">Not run yet. It reads the register, contacts shareholders and flags problems. Its key can only flag, pause, freeze and log.</p>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" disabled={busy || executed} onClick={() => run('Agent', 'agent-run')}>
                {running === 'Agent' ? <><Spinner /> Working… about a minute</> : report ? 'Run again' : 'Run the caretaker agent'}
              </button>
              <Link href="/agent" className="btn secondary">Agent log</Link>
            </div>
            {attestation && <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>✓ {attestation.title}</p>}
            <Reply reply={reply?.label === 'Agent' ? reply : null} />

            {s.proposals.map((p) => (
              <div key={p.id} className={`proposal ${p.status === 'applied' ? 'applied' : ''}`}>
                <div className="row">
                  <Icon name="puzzle" className="" />
                  <strong>{p.status === 'applied' ? 'Correction applied' : 'The agent spotted an unrecorded transfer'}</strong>
                </div>
                <div className="change">
                  {p.corrections.map((c) => {
                    const h = s.holders.find((x) => x.accountId === c.holder_id);
                    return <span key={c.holder_id}>{h?.name ?? c.holder_id.slice(0, 8)} → {c.shares.toLocaleString('en')}</span>;
                  })}
                </div>
                <p className="small" style={{ margin: '0 0 10px' }}>{p.explanation}</p>
                {p.status === 'proposed' ? (
                  <>
                    <button className="btn small" disabled={busy || executed} onClick={() => run('Apply', 'apply', { proposalId: p.id })}>
                      {running === 'Apply' ? <><Spinner /> Applying…</> : 'Apply correction'}
                    </button>
                    <div className="tiny muted" style={{ marginTop: 8 }}>Only the company admin can apply it, and only where the shareholders disputed. Both then confirm the new numbers.</div>
                  </>
                ) : (
                  <div className="tiny muted">Both shareholders now confirm the corrected numbers in the investor app.</div>
                )}
              </div>
            ))}
            <Reply reply={reply?.label === 'Apply' ? reply : null} />
          </section>

          <section className="card">
            <div className="card-head">
              <div className="card-icon"><Icon name="euro" /></div>
              <div>
                <h2>{executed ? 'Payout complete' : 'Checks before paying'}</h2>
                <div className="small muted">{euros(s.event?.total)} in test euros · funded {euros(s.event?.funded)}</div>
              </div>
            </div>
            {s.checks.map((c) => (
              <div key={c.label} className="check">
                <span className={`mark ${c.ok ? 'ok' : 'no'}`}><Icon name={c.ok ? 'check' : 'x'} /></span>
                <div>
                  <div className="label">{c.label}</div>
                  <div className="small muted">{c.detail}</div>
                </div>
              </div>
            ))}
            {!executed ? (
              <>
                <button className="btn lg" style={{ width: '100%', marginTop: 14 }} disabled={busy || !allChecks} onClick={() => run('Payout', 'payout')}>
                  {running === 'Payout' ? <><Spinner /> Paying…</> : 'Run exit payout'}
                </button>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  {allChecks ? 'Anyone not ready is held, never lost: their share waits in the contract until they claim it.' : 'Enabled when every check passes.'}
                </p>
              </>
            ) : (
              s.event && (
                <>
                  <div className="grid cols-2" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 14, gap: 12 }}>
                    <div><div className="tiny muted">Paid</div><strong>{euros(s.event.totals.paid)}</strong></div>
                    <div><div className="tiny muted">Queued for bank</div><strong>{euros(s.event.totals.queued)}</strong></div>
                    <div><div className="tiny muted">Held for later</div><strong>{euros(s.event.totals.held)}</strong></div>
                    <div><div className="tiny muted">Rounding remainder</div><strong>{s.event.totals.remainder} units</strong></div>
                  </div>
                  {s.event.manifestRoot && (
                    <div className="notice info small" style={{ marginBottom: 0 }}>
                      <strong>Proof published before any money moved.</strong> Manifest root:
                      <span className="mono">{s.event.manifestRoot}</span>
                    </div>
                  )}
                </>
              )
            )}
            <Reply reply={reply?.label === 'Payout' ? reply : null} />
          </section>
        </div>
      </div>

      <p className="tiny muted" style={{ marginTop: 28 }}>
        Contract <a href={s.registry.explorer} target="_blank" rel="noreferrer" className="mono">{s.registry.id}</a> on NEAR testnet
      </p>
    </main>
  );
}
