'use client';

import type { ResetStatus } from '@/server/reset.ts';
import { Icon, Loading, Reply, Spinner, useAction, usePoll } from '@/app/ui';

const PHASE: Record<string, string> = {
  recycling: 'Taking down the old copy',
  seeding: 'Setting up the new copy',
  done: 'Ready',
  failed: 'Stopped before it finished',
};

export default function ResetPage() {
  const status = usePoll<ResetStatus>('/api/reset-status', 3000);
  const action = useAction(status.refresh);
  const s = status.data;

  return (
    <main>
      <div className="page-head">
        <div>
          <div className="eyebrow">Demo tool · NEAR testnet</div>
          <h1>Reset demo</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Starts exit day again with fresh dates. The demo clock is fast (details go stale after 10 minutes), and the contract has no way
            to rewrite dates, so a reset puts a brand-new copy of the contract on testnet and seeds the five Acme shareholders again. The old
            copy&apos;s accounts are deleted and their test NEAR goes back to the platform, so a reset costs almost nothing.
          </p>
        </div>
      </div>

      <section className="card">
        {!s ? (
          <Loading error={status.error} />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <strong>{s.running ? <><Spinner /> {PHASE[s.phase ?? 'seeding']}…</> : s.phase ? PHASE[s.phase] : 'No reset yet'}</strong>
                {s.from && s.to && (
                  <div className="small muted">
                    Copy {s.from} → {s.to}
                    {s.startedAt && ` · started ${new Date(s.startedAt).toLocaleTimeString()}`}
                    {s.endedAt && !s.running && ` · finished ${new Date(s.endedAt).toLocaleTimeString()}`}
                  </div>
                )}
              </div>
              <button
                className="btn lg"
                disabled={s.running || action.running !== null}
                onClick={() => {
                  if (confirm('Reset the demo? Everything done so far in the demo is cleared. It takes a few minutes.')) action.run('Reset', 'reset');
                }}
              >
                <Icon name="sparkle" /> {s.phase === 'failed' ? 'Continue the reset' : 'Reset demo'}
              </button>
            </div>
            <Reply reply={action.reply} />
            {s.log.length > 0 && (
              <pre className="mono small" style={{ marginTop: 16, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
                {s.log.join('\n')}
              </pre>
            )}
          </>
        )}
      </section>
    </main>
  );
}
