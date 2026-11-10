'use client';

import type { ResetStatus } from '@/server/reset.ts';
import { Icon, Loading, Reply, Spinner, useAction, usePoll } from '@/app/ui';

const PHASE: Record<string, string> = {
  recycling: 'Taking down the old copy',
  seeding: 'Setting up the new copy',
  settling: 'Waiting for the shareholders’ first choices to take effect',
  done: 'Ready',
  failed: 'Stopped before it finished',
};

/**
 * The reset waits until the cast's set-up changes are active (settlesAt), so a demo has no
 * waits after it. Confirmed details turn amber after an hour and red after two (demo clock).
 */
function DemoWindow({ seededAt, settlesAt }: { seededAt: string; settlesAt?: string }) {
  const t0 = new Date(seededAt).getTime();
  const ready = settlesAt ? new Date(settlesAt).getTime() : t0 + 5 * 60_000;
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const at = (min: number) => hm(t0 + min * 60_000);
  const now = Date.now();
  const state = now < ready ? 'early' : now < t0 + 60 * 60_000 ? 'open' : 'late';
  return (
    <div className={`notice ${state === 'open' ? 'ok' : 'warn'}`} style={{ marginTop: 16 }}>
      <strong>
        {state === 'early' && `Set-up still settling: ready at ${hm(ready)}.`}
        {state === 'open' && `Ready: click through at your own pace (until about ${at(60)}).`}
        {state === 'late' && 'Shareholders’ details need a fresh look on the demo clock. Reset the demo for a clean run.'}
      </strong>
      <div className="small">
        Seeded {at(0)}. The shareholders’ first payout choices take effect at {hm(ready)}; their details need a fresh look from {at(60)} and
        are out of date from {at(120)} (demo clock; in real life, 12 months).
      </div>
    </div>
  );
}

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
            Starts exit day again with fresh dates. It takes about 5 minutes, and then every step works straight away. The contract has no way
            to rewrite dates, so a reset puts a brand-new copy of the contract on testnet and seeds Acme&apos;s seven shareholders again. The old
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
            {!s.running && s.seededAt && <DemoWindow seededAt={s.seededAt} settlesAt={s.settlesAt} />}
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
