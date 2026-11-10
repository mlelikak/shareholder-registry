'use client';

import type { AgentLogEntry } from '@/server/store.ts';
import type { Attestation, ReplyProof } from '@/server/nearai.ts';
import { Icon, Loading, usePoll, type DemoState } from '@/app/ui';

const KIND: Record<string, { icon: string; label: string }> = {
  report: { icon: 'list', label: 'Report' },
  finding: { icon: 'search', label: 'Finding' },
  proposal: { icon: 'puzzle', label: 'Proposal' },
  message: { icon: 'mail', label: 'Message sent' },
  chain: { icon: 'chain', label: 'On-chain' },
  attestation: { icon: 'lock', label: 'Enclave check' },
  refusal: { icon: 'stop', label: 'Refused' },
  error: { icon: 'alert', label: 'Problem' },
};

function Proof({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div>
      <span style={{ color: ok ? 'var(--green)' : 'var(--red)', display: 'inline-flex' }}><Icon name={ok ? 'check' : 'x'} /></span>
      <span>{children}</span>
    </div>
  );
}

function AttestationDetail({ data }: { data: { attestation?: Attestation[]; proofs?: ReplyProof[] } }) {
  const a = data.attestation?.find((x) => x.keyInQuote) ?? data.attestation?.[0];
  const p = data.proofs ?? [];
  return (
    <div className="proof-list">
      <Proof ok={p.length > 0 && p.every((x) => x.hashesMatch && x.signatureValid)}>
        Each AI reply ({p.length}) is signed, and the signature covers the exact request and reply
      </Proof>
      <Proof ok={p.length > 0 && p.every((x) => x.attested)}>The signing key belongs to the attested enclave</Proof>
      {a && (
        <>
          <Proof ok={a.keyInQuote}>That key is inside the Intel TDX hardware quote</Proof>
          <Proof ok={a.nonceInQuote}>The quote contains our fresh random number, so it was made just now</Proof>
          <Proof ok={a.nvidiaEvidence}>NVIDIA GPU evidence is included</Proof>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Model {a.model} · enclave key <code>{a.signingAddress.slice(0, 12)}…</code> · the Intel and NVIDIA certificate chains are not re-checked here; they
            passed NEAR&apos;s open-source verifier (<a href="https://github.com/nearai/nearai-cloud-verifier" target="_blank" rel="noreferrer">nearai-cloud-verifier</a>) on Nov 1, and anyone can run it again
          </div>
        </>
      )}
    </div>
  );
}

export default function AgentPage() {
  const log = usePoll<AgentLogEntry[]>('/api/agent-log', 8000);
  const state = usePoll<DemoState>('/api/state', 30000);
  return (
    <main>
      <div className="page-head">
        <div>
          <div className="eyebrow">Caretaker agent</div>
          <h1>Agent log</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Everything the agent did, newest first. Readable details stay here, off-chain. The chain only gets a hash of each summary, so
            what the agent recorded can be proven later without the chain saying why.
          </p>
        </div>
      </div>
      <div className="split">
        <section className="card">
          {!log.data ? (
            <Loading error={log.error} />
          ) : log.data.length === 0 ? (
            <p className="muted">Nothing yet. Run the agent from the Company page.</p>
          ) : (
            <div className="timeline">
              {log.data.map((e) => (
                <div key={e.id} className="t-item">
                  <div className={`t-icon ${e.kind}`}><Icon name={KIND[e.kind]?.icon ?? 'list'} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="t-meta">{KIND[e.kind]?.label} · {new Date(e.at).toLocaleTimeString()}</div>
                    <div className="t-title">{e.title}</div>
                    {e.kind === 'attestation' ? (
                      <AttestationDetail data={(e.data ?? {}) as { attestation?: Attestation[]; proofs?: ReplyProof[] }} />
                    ) : e.kind === 'chain' ? null : (
                      e.detail && <div className={e.kind === 'refusal' || e.kind === 'error' ? 'small mono' : 'small'} style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{e.detail}</div>
                    )}
                    {(e.summaryHash || e.txHash) && (
                      <div className="tiny muted" style={{ marginTop: 6 }}>
                        {e.summaryHash && <>Hash on-chain <code>{e.summaryHash.slice(0, 14)}…</code> </>}
                        {e.txHash && <a href={`https://testnet.nearblocks.io/txns/${e.txHash}`} target="_blank" rel="noreferrer">transaction ↗</a>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="card">
          <div className="card-head">
            <div className="card-icon"><Icon name="shield" /></div>
            <h2>What the agent can do</h2>
          </div>
          <p className="small">Its NEAR account holds a single restricted key. The network itself refuses anything else.</p>
          {state.data && (
            <>
              <div className="stack" style={{ gap: 6 }}>
                {state.data.agent.allowedMethods.map((m) => (
                  <div key={m} className="row small"><span style={{ color: 'var(--green)', display: 'inline-flex' }}><Icon name="check" /></span><code>{m}</code></div>
                ))}
                {['change payout details', 'set share counts', 'move money'].map((m) => (
                  <div key={m} className="row small muted"><span style={{ color: 'var(--red)', display: 'inline-flex' }}><Icon name="x" /></span>cannot {m}</div>
                ))}
              </div>
              <a className="btn secondary small" style={{ marginTop: 14 }} href={state.data.agent.explorer} target="_blank" rel="noreferrer">
                See its key on the explorer ↗
              </a>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
