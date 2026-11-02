'use client';

import type { AgentLogEntry } from '@/server/store.ts';
import type { Attestation, ReplyProof } from '@/server/nearai.ts';
import { Loading, usePoll, type DemoState } from '@/app/ui';

const KIND: Record<string, { icon: string; label: string }> = {
  report: { icon: '📋', label: 'Report' },
  finding: { icon: '🔎', label: 'Finding' },
  proposal: { icon: '🧩', label: 'Proposal' },
  message: { icon: '✉️', label: 'Message' },
  chain: { icon: '⛓️', label: 'On-chain' },
  attestation: { icon: '🔒', label: 'Enclave' },
  refusal: { icon: '🛑', label: 'Refused' },
  error: { icon: '⚠️', label: 'Problem' },
};

function AttestationDetail({ data }: { data: { attestation?: Attestation[]; proofs?: ReplyProof[] } }) {
  const a = data.attestation?.find((x) => x.keyInQuote) ?? data.attestation?.[0];
  return (
    <div className="small">
      {data.proofs?.map((p) => (
        <div key={p.chatId}>
          Reply <code>{p.chatId.slice(0, 12)}…</code>: request and reply hashes match {p.hashesMatch ? '✓' : '✗'} · signature valid{' '}
          {p.signatureValid ? '✓' : '✗'} · signed by the attested enclave key {p.attested ? '✓' : '✗'}
        </div>
      ))}
      {a && (
        <div style={{ marginTop: 4 }}>
          Intel TDX quote v{a.quoteVersion} (TEE type {a.teeType}): enclave key inside the quote {a.keyInQuote ? '✓' : '✗'} · our fresh
          nonce inside the quote {a.nonceInQuote ? '✓' : '✗'} · NVIDIA GPU evidence {a.nvidiaEvidence ? '✓' : '✗'}
          <div className="muted">
            Model {a.model}. The Intel and NVIDIA certificate chains are checked with NEAR&apos;s open-source verifier (see README).
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentPage() {
  const log = usePoll<AgentLogEntry[]>('/api/agent-log', 8000);
  const state = usePoll<DemoState>('/api/state', 30000);
  if (!log.data) return <main><Loading error={log.error} /></main>;
  return (
    <main>
      <h1>Agent log</h1>
      <p className="lead">
        Everything the caretaker agent did, newest first. Readable details stay here, off-chain; the chain only gets a hash of each
        summary, so what the agent recorded can be proven later without the chain saying why.
        {state.data && (
          <>
            {' '}The agent&apos;s account{' '}
            <a href={state.data.agent.explorer} target="_blank" rel="noreferrer" className="mono">{state.data.agent.id}</a> holds a single
            key, limited to{' '}
            {state.data.agent.allowedMethods.map((m) => (
              <code key={m} style={{ marginRight: 6 }}>{m}</code>
            ))}
          </>
        )}
      </p>
      <div className="panel">
        {log.data.length === 0 && <p className="muted">Nothing yet. Run the agent from the Company screen.</p>}
        {log.data.map((e) => (
          <div key={e.id} className="log-entry">
            <div className="when">
              {new Date(e.at).toLocaleTimeString()}
              <div>{KIND[e.kind]?.icon} {KIND[e.kind]?.label}</div>
            </div>
            <div>
              <strong>{e.title}</strong>
              {e.kind === 'attestation' ? (
                <>
                  {e.detail && <div className="small muted">{e.detail}</div>}
                  <AttestationDetail data={(e.data ?? {}) as { attestation?: Attestation[]; proofs?: ReplyProof[] }} />
                </>
              ) : (
                e.detail && (
                  <div style={{ whiteSpace: 'pre-wrap' }} className={e.kind === 'chain' || e.kind === 'refusal' ? 'small mono' : ''}>
                    {e.detail}
                  </div>
                )
              )}
              <div className="small" style={{ marginTop: 4 }}>
                {e.summaryHash && (
                  <span className="muted">
                    hash on-chain: <code>{e.summaryHash.slice(0, 16)}…</code>{' '}
                  </span>
                )}
                {e.txHash && (
                  <a href={`https://testnet.nearblocks.io/txns/${e.txHash}`} target="_blank" rel="noreferrer">
                    transaction ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
