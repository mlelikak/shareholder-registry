'use client';

import { Icon, Loading, Reply, Spinner, useAction, usePoll, type ActionReply, type DemoState } from '@/app/ui';

type Fraud = { email: string; modelVerdict: string; modelReply: string; attempt: { ok: boolean; error?: string } };

function FraudResult({ reply }: { reply: ActionReply & { label: string } }) {
  const r = reply.result as Fraud | undefined;
  if (!r) return <Reply reply={reply} />;
  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <pre style={{ margin: 0 }}>{r.email}</pre>
      <div className={`notice ${r.modelVerdict === 'refuse' ? 'ok' : 'warn'}`} style={{ margin: 0 }}>
        <strong>Step 1, the AI reads it: &quot;{r.modelVerdict}&quot;.</strong> {r.modelReply}
      </div>
      <div className={`notice ${r.attempt.ok ? 'bad' : 'ok'}`} style={{ margin: 0 }}>
        <strong>Step 2, a fooled agent tries anyway:</strong> its key calls <code>request_payout_change</code>.{' '}
        {r.attempt.ok ? 'IT WAS ACCEPTED. This must never happen.' : 'The NEAR network rejects it:'}
        {r.attempt.error && <span className="mono">{r.attempt.error}</span>}
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Refused before it reached the chain, so there is no transaction. The proof is the agent account&apos;s key list on the explorer.
        </div>
      </div>
    </div>
  );
}

export default function AttackerPage() {
  const state = usePoll<DemoState>('/api/state', 30000);
  const { running, reply, run } = useAction();
  const s = state.data;
  if (!s) return <main><Loading error={state.error} /></main>;
  const busy = Boolean(running);
  return (
    <main>
      <div className="page-head">
        <div>
          <div className="eyebrow">Demo tool · real attempts on NEAR testnet</div>
          <h1>Try to steal Maria&apos;s payout</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Only Maria can change where her money goes, with her own login. Even then the change waits, and her daughter Anna is alerted and
            can cancel it.
          </p>
        </div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <div className="card-head">
            <div className="card-icon red"><Icon name="users" /></div>
            <div><h2>A stranger</h2><div className="small muted">An unrelated account asks the contract to send Maria&apos;s payout to itself.</div></div>
          </div>
          <button className="btn danger" disabled={busy} onClick={() => run('Stranger', 'attack', { who: 'outsider' })}>
            {running === 'Stranger' ? <><Spinner /> Trying…</> : "Redirect Maria's payout"}
          </button>
          <Reply reply={reply?.label === 'Stranger' ? reply : null} expectRefusal />
        </section>
        <section className="card">
          <div className="card-head">
            <div className="card-icon red"><Icon name="building" /></div>
            <div><h2>The company itself</h2><div className="small muted">{s.company.name}&apos;s own admin tries the same. Insiders can&apos;t touch payout details either.</div></div>
          </div>
          <button className="btn danger" disabled={busy} onClick={() => run('Company admin', 'attack', { who: 'insider' })}>
            {running === 'Company admin' ? <><Spinner /> Trying…</> : 'Try as the company admin'}
          </button>
          <Reply reply={reply?.label === 'Company admin' ? reply : null} expectRefusal />
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-icon red"><Icon name="bot" /></div>
          <div>
            <h2>A fraud email to the AI agent</h2>
            <div className="small muted">
              A fake &quot;finance team&quot; email tells the agent to change Maria&apos;s payout account. The model reads it inside the enclave. Then we
              simulate a fooled agent: its own key tries the change, and the NEAR network checks what that key may do.
            </div>
          </div>
        </div>
        <button className="btn danger" disabled={busy} onClick={() => run('Fraud email', 'agent-fraud')}>
          {running === 'Fraud email' ? <><Spinner /> The agent is reading the email…</> : 'Send the fraud email'}
        </button>
        {reply?.label === 'Fraud email' && <FraudResult reply={reply} />}
      </section>
    </main>
  );
}
