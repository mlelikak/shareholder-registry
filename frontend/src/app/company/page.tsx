'use client';

import Link from 'next/link';
import type { AgentLogEntry } from '@/server/store.ts';
import { euros, ISSUE_TEXT, Loading, Reply, StatusPill, useAction, usePoll, type DemoState } from '@/app/ui';

const OUTCOME_TEXT: Record<string, string> = {
  paid: 'Paid',
  in_flight: 'Sending',
  queued: 'Queued for bank (simulated)',
  held: 'Held until they claim',
  awaiting_route: 'Waiting for cross-chain delivery',
  released: 'Cross-chain delivery in progress',
  settling: 'Settling',
};

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

  return (
    <main>
      <h1>{s.company.name} · exit payout</h1>
      <p className="lead">
        {s.company.name} has been sold. Before paying {s.holders.length} shareholders, the caretaker agent checks every holder is
        verified, reachable and agrees with their share count. The contract calculates the amounts and refuses to pay if any check fails.
      </p>

      <div className="grid cols-4">
        <div className="panel stat">
          <div className="num">{s.readiness.ready} of {s.readiness.total}</div>
          <div className="label">ready to be paid</div>
        </div>
        <div className="panel stat">
          <div className="num">{s.readiness.counts.unreachable}</div>
          <div className="label">unreachable</div>
        </div>
        <div className="panel stat">
          <div className="num">{s.readiness.counts.disputed}</div>
          <div className="label">dispute their share count</div>
        </div>
        <div className="panel stat">
          <div className="num">{s.readiness.counts.kyc}</div>
          <div className="label">identity check needed</div>
        </div>
      </div>

      <h2>Caretaker agent</h2>
      <div className="panel">
        <div className="row">
          <button className="btn" disabled={busy || executed} onClick={() => run('Caretaker agent', 'agent-run')}>
            {running === 'Caretaker agent' ? 'Agent working… (about a minute)' : 'Run the caretaker agent'}
          </button>
          <span className="muted small">
            Reads the register, contacts holders, flags and pauses with a key that{' '}
            <a href={s.agent.explorer} target="_blank" rel="noreferrer">can only call {s.agent.allowedMethods.length} methods</a>.
          </span>
        </div>
        {(running === 'Caretaker agent' || running === 'Apply correction') && <p className="muted">Working on NEAR testnet and NEAR AI Cloud…</p>}
        <Reply reply={reply && ['Caretaker agent', 'Apply correction'].includes(reply.label) ? reply : null} />
        {report ? (
          <>
            <h3 style={{ marginTop: 16 }}>{report.title}</h3>
            <p style={{ marginTop: 0 }}>{report.detail}</p>
            {attestation && (
              <p className="small muted">
                🔒 Written inside an attested enclave on NEAR AI Cloud. {attestation.title}.{' '}
                <Link href="/agent">See the agent log</Link>
              </p>
            )}
          </>
        ) : (
          <p className="muted">The agent has not run yet for this payout.</p>
        )}

        {s.proposals.map((p) => (
          <div key={p.id} className={`notice ${p.status === 'applied' ? 'ok' : 'warn'}`}>
            <strong>{p.status === 'applied' ? 'Applied: ' : 'Agent proposes: '}</strong>
            {p.title}
            <p style={{ margin: '6px 0' }}>{p.explanation}</p>
            {p.status === 'proposed' ? (
              <div className="row">
                <button className="btn small" disabled={busy || executed} onClick={() => run('Apply correction', 'apply', { proposalId: p.id })}>
                  Apply correction (company admin)
                </button>
                <span className="small muted">The agent's key can't change share counts. Only the admin can, and only where holders disputed.</span>
              </div>
            ) : (
              <span className="small muted">Both holders must now confirm the corrected numbers before they can be paid.</span>
            )}
          </div>
        ))}
      </div>

      <h2>Register</h2>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Shareholder</th>
              <th>Shares</th>
              <th>Status</th>
              <th>What needs doing</th>
              <th>{executed ? 'Payout' : 'Paid via'}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s.holders.map((h) => (
              <tr key={h.accountId}>
                <td>
                  <strong>{h.name}</strong>
                  <div className="small">
                    <a href={h.explorer} target="_blank" rel="noreferrer" className="mono" title="Random account: on-chain, nobody can tell this is them">
                      {h.accountId.slice(0, 10)}…
                    </a>
                  </div>
                </td>
                <td>
                  {h.shares.toLocaleString('en')}
                  {h.claimedShares !== undefined && <div className="small" style={{ color: 'var(--red)' }}>says {h.claimedShares.toLocaleString('en')}</div>}
                  {h.confirmation === 'confirmed' && <div className="small muted">confirmed ✓</div>}
                </td>
                <td>
                  <StatusPill status={h.status} />
                  {h.ready && <div className="small" style={{ color: 'var(--green)', marginTop: 4 }}>ready</div>}
                </td>
                <td>
                  {h.issues.length ? h.issues.map((i) => <span key={i} className="tag">{ISSUE_TEXT[i] ?? i}</span>) : <span className="muted small">nothing</span>}
                </td>
                <td>
                  {executed && h.line ? (
                    <>
                      {euros(h.line.amount)}
                      <div className="small muted">{OUTCOME_TEXT[h.line.outcome] ?? h.line.outcome}</div>
                    </>
                  ) : (
                    <span className="small">{{ near: 'Own account', bank: 'Bank (simulated)', intents: 'Other chain (Intents)' }[h.payoutMethod ?? ''] ?? '–'}</span>
                  )}
                </td>
                <td>
                  {!executed && !h.issues.includes('contact_bounced') && (
                    <button className="btn secondary small" disabled={busy} onClick={() => run(`Simulate ${h.name}'s email bouncing`, 'bounce', { holder: h.key })}>
                      Simulate bounce
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Names are shown only here, off-chain. On-chain each shareholder is a random account with a share count.
        </p>
      </div>
      <Reply reply={reply && reply.label.startsWith('Simulate') ? reply : null} />

      <h2>Checks before paying</h2>
      <div className="grid cols-2">
        <div className="panel">
          {s.checks.map((c) => (
            <div key={c.label} className="check">
              <span className={`mark ${c.ok ? 'ok' : 'no'}`}>{c.ok ? '✓' : '✗'}</span>
              <div>
                {c.label}
                <div className="small muted">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          {s.event && (
            <>
              <div className="row">
                <div>
                  <div className="muted small">Payout total</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{euros(s.event.total)}</div>
                  <div className="small muted">test euros, funded {euros(s.event.funded)}</div>
                </div>
              </div>
              {!executed ? (
                <>
                  <p className="small">
                    Holders who aren't ready are <strong>held, never lost</strong>: their share stays in the contract until they come back and claim it.
                  </p>
                  <button className="btn" disabled={busy || !allChecks} onClick={() => run('Exit payout', 'payout')}>
                    {running === 'Exit payout' ? 'Paying…' : 'Run exit payout'}
                  </button>
                  {!allChecks && <p className="small muted">Enabled when every check passes.</p>}
                </>
              ) : (
                <>
                  <div className="grid cols-2" style={{ marginTop: 12 }}>
                    <div><div className="muted small">Paid</div><strong>{euros(s.event.totals.paid)}</strong></div>
                    <div><div className="muted small">Queued (bank)</div><strong>{euros(s.event.totals.queued)}</strong></div>
                    <div><div className="muted small">Held for later</div><strong>{euros(s.event.totals.held)}</strong></div>
                    <div><div className="muted small">Rounding remainder</div><strong>{s.event.totals.remainder} units</strong></div>
                  </div>
                  {s.event.manifestRoot && (
                    <p className="small">
                      Manifest root, published on-chain before any money moved:
                      <br />
                      <code>{s.event.manifestRoot}</code>
                    </p>
                  )}
                </>
              )}
              <Reply reply={reply?.label === 'Exit payout' ? reply : null} />
            </>
          )}
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 24 }}>
        Contract: <a href={s.registry.explorer} target="_blank" rel="noreferrer" className="mono">{s.registry.id}</a> on NEAR testnet.
      </p>
    </main>
  );
}
