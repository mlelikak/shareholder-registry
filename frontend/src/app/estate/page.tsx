'use client';

import { euros, Icon, Loading, Reply, Spinner, useAction, usePoll } from '@/app/ui';

type EstateView = {
  holder: { name: string; accountId: string; state: string; transferredTo: string | null };
  helpers: string[];
  held: string;
  estate: { accountId: string; balance: string } | null;
  documents: string;
  reportedBy?: string;
  reportedAt?: string;
  freezeTx?: string;
  case?: {
    representative: string;
    documents: string[];
    missing: string[];
    estateAccount: string;
    accountMatches: boolean;
    summary: string;
    summaryHash: string;
    logTx?: string;
  };
  approveTx?: string;
  collectTx?: string;
};

const short = (id: string) => `${id.slice(0, 10)}…${id.slice(-4)}`;

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div className="card flat" style={{ opacity: done ? 1 : 0.95 }}>
      <div className="card-head">
        <div className={`card-icon ${done ? '' : 'red'}`}>{done ? <Icon name="check" /> : <span style={{ fontWeight: 700 }}>{n}</span>}</div>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function EstatePage() {
  const s = usePoll<EstateView>('/api/estate', 6000);
  const { running, reply, run } = useAction(s.refresh);
  const v = s.data;
  const busy = running !== null;

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="eyebrow">Demo tool · estate reviewer (a person, not the AI)</div>
          <h1>Estate review</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            When a shareholder dies, their record is frozen, the caretaker agent prepares the case inside the NEAR AI Cloud enclave, and only
            a human reviewer can move the holding to the estate. In this demo the shareholder is the fictional Erik and the documents are
            simulated. On-chain, everything reads only &ldquo;frozen&rdquo; and &ldquo;transferred&rdquo;, never why.
          </p>
        </div>
      </div>

      {!v ? (
        <Loading error={s.error} />
      ) : (
        <div className="stack-lg">
          <Step n={1} done={Boolean(v.reportedAt) || v.holder.state !== 'active'} title={`A helper reports the death${v.helpers.length ? ` (${v.helpers.join(', ')})` : ''}`}>
            {v.holder.state === 'active' ? (
              <p className="small" style={{ margin: 0 }}>
                Open the <a href="/me">investor app</a>, log in as <strong>Jonas</strong> (Erik&apos;s son and helper) and tap &ldquo;Tell us Erik has
                died&rdquo;. His own key freezes Erik&apos;s record, so payouts to Erik are held from then on.
              </p>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                Erik&apos;s record is <strong>{v.holder.state}</strong>.{' '}
                {v.freezeTx && <a href={v.freezeTx} target="_blank" rel="noreferrer">The freeze on the explorer ↗</a>} The agent emailed Jonas
                the next steps (see the <a href="/inbox">Demo inbox</a>).
              </p>
            )}
          </Step>

          <Step n={2} done={Boolean(v.case)} title="The agent prepares the case">
            <details>
              <summary className="small">The documents the family sent (simulated)</summary>
              <pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>{v.documents}</pre>
            </details>
            {v.case ? (
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                <div>{v.case.summary}</div>
                <div className="small">
                  Representative: <strong>{v.case.representative || '–'}</strong> · Documents: {v.case.documents.join(', ') || '–'}
                  {v.case.missing.length > 0 && <> · Missing: {v.case.missing.join(', ')}</>}
                </div>
                <div className={`notice ${v.case.accountMatches ? 'ok' : 'bad'} small`}>
                  {v.case.accountMatches
                    ? `The estate account in the documents (${short(v.case.estateAccount)}) matches the account on file. Checked by code, not by the AI.`
                    : `The account in the documents (${v.case.estateAccount || 'none found'}) does not match the account on file. Do not approve.`}
                </div>
                <div className="small muted">
                  Read inside the attested enclave (see the <a href="/agent">Agent log</a>). Only a fingerprint of the summary is on-chain
                  {v.case.logTx && <> (<a href={v.case.logTx} target="_blank" rel="noreferrer">log entry ↗</a>)</>}.
                </div>
              </div>
            ) : (
              <button className="btn" disabled={busy || v.holder.state !== 'frozen'} onClick={() => run('Prepare', 'estate-prepare')}>
                {running === 'Prepare' ? <><Spinner /> Reading in the enclave…</> : <><Icon name="bot" /> Agent: read the documents</>}
              </button>
            )}
          </Step>

          <Step n={3} done={v.holder.state === 'transferred'} title="The human reviewer decides">
            {v.holder.state === 'transferred' ? (
              <p className="small" style={{ margin: 0 }}>
                Approved: Erik&apos;s holding now belongs to the estate&apos;s account {v.holder.transferredTo && <span className="mono">{short(v.holder.transferredTo)}</span>}.{' '}
                {v.approveTx && <a href={v.approveTx} target="_blank" rel="noreferrer">On the explorer ↗</a>}
              </p>
            ) : (
              <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                <button className="btn" disabled={busy || v.holder.state !== 'frozen' || !v.case?.accountMatches} onClick={() => run('Approve', 'estate-approve')}>
                  {running === 'Approve' ? <Spinner /> : <Icon name="check" />} Approve transfer to the estate
                </button>
                <button className="btn secondary" disabled={busy || v.holder.state !== 'frozen'} onClick={() => run('Unfreeze', 'estate-unfreeze')}>
                  Lift the freeze (reported by mistake)
                </button>
                <span className="small muted">Only the reviewer&apos;s key can do either. The agent and helpers can freeze, never unfreeze.</span>
              </div>
            )}
          </Step>

          <Step n={4} done={Boolean(v.collectTx)} title="The estate collects the money kept for Erik">
            <p className="small" style={{ marginTop: 0 }}>
              Kept for Erik: <strong>{euros(v.held)}</strong>
              {v.estate && <> · Estate account balance: <strong>{euros(v.estate.balance)}</strong> (test euros)</>}
              {v.held === '0' && v.holder.state !== 'active' && !v.collectTx && <> · Run the exit payout first; Erik&apos;s share is held while he is frozen.</>}
            </p>
            {v.collectTx ? (
              <a className="small" href={v.collectTx} target="_blank" rel="noreferrer">Paid to the estate, on the explorer ↗</a>
            ) : (
              <button className="btn" disabled={busy || v.holder.state !== 'transferred' || v.held === '0'} onClick={() => run('Collect', 'estate-collect')}>
                {running === 'Collect' ? <Spinner /> : <Icon name="euro" />} Estate: collect the money
              </button>
            )}
          </Step>

          <Reply reply={reply} />
        </div>
      )}
    </main>
  );
}
