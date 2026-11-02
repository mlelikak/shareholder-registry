'use client';

import { Loading, Reply, useAction, usePoll, type ActionReply, type DemoState } from '@/app/ui';

type Fraud = { email: string; modelVerdict: string; modelReply: string; attempt: { ok: boolean; error?: string } };

function FraudResult({ reply }: { reply: ActionReply & { label: string } }) {
  const r = reply.result as Fraud | undefined;
  if (!r) return <Reply reply={reply} />;
  return (
    <>
      <pre>{r.email}</pre>
      <div className={`notice ${r.modelVerdict === 'refuse' ? 'ok' : 'warn'}`}>
        <strong>The AI says: {r.modelVerdict}.</strong> {r.modelReply}
      </div>
      <div className={`notice ${r.attempt.ok ? 'bad' : 'ok'}`}>
        <strong>Simulated fooled agent:</strong> its key tried <code>request_payout_change</code>.{' '}
        {r.attempt.ok ? 'IT WAS ACCEPTED. This must never happen.' : 'Rejected by the NEAR network:'}
        {r.attempt.error && <div className="small mono" style={{ marginTop: 6 }}>{r.attempt.error}</div>}
        <div className="small" style={{ marginTop: 6 }}>
          The network refused it before it reached the chain, so there is no transaction to show. The proof is the agent account&apos;s
          key list on the explorer.
        </div>
      </div>
    </>
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
      <h1>Attacker panel</h1>
      <p className="lead">
        Three ways someone might try to redirect Maria&apos;s exit payment. Each is a real attempt on NEAR testnet. Only Maria can
        change her payout details, with her own login, and even then the change waits and her daughter Anna is alerted.
      </p>

      <div className="grid cols-2">
        <div className="panel">
          <h3>1. A stranger</h3>
          <p className="small">An unrelated account calls the contract to send Maria&apos;s payout to itself.</p>
          <button className="btn danger" disabled={busy} onClick={() => run('Stranger', 'attack', { who: 'outsider' })}>
            {running === 'Stranger' ? 'Trying…' : "Try to redirect Maria's payout"}
          </button>
          <Reply reply={reply?.label === 'Stranger' ? reply : null} expectRefusal />
        </div>
        <div className="panel">
          <h3>2. The company itself</h3>
          <p className="small">
            {s.company.name}&apos;s own admin account tries the same. A company insider can&apos;t touch payout details either.
          </p>
          <button className="btn danger" disabled={busy} onClick={() => run('Company admin', 'attack', { who: 'insider' })}>
            {running === 'Company admin' ? 'Trying…' : 'Try as the company admin'}
          </button>
          <Reply reply={reply?.label === 'Company admin' ? reply : null} expectRefusal />
        </div>
      </div>

      <h2>3. A fraud email to the AI agent</h2>
      <div className="panel">
        <p className="small" style={{ marginTop: 0 }}>
          A fake &quot;finance team&quot; email tells the caretaker agent to update Maria&apos;s payout account before the exit. The model
          reads it inside the enclave. Then we simulate a <strong>fooled agent</strong>: its own key tries the change anyway, and the NEAR
          network checks what that key is allowed to do.
        </p>
        <button className="btn danger" disabled={busy} onClick={() => run('Fraud email', 'agent-fraud')}>
          {running === 'Fraud email' ? 'The agent is reading the email…' : 'Send the fraud email to the agent'}
        </button>
        {reply?.label === 'Fraud email' && <FraudResult reply={reply} />}
      </div>
    </main>
  );
}
