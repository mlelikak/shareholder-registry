'use client';

import Link from 'next/link';
import { Icon, Spinner, useAction, usePoll } from '@/app/ui';

type DemoStatus = { running: boolean; phase: string | null; seededAt: string | null; hasCopy: boolean; payoutState: string | null };

/**
 * Tells a visitor, before step 1, whether this demo copy is fresh or needs a reset.
 * Demo clock (DESIGN.md section 4): set-up settles at 5 minutes, details go stale at 20.
 */
export function DemoStatusBox() {
  const status = usePoll<DemoStatus>('/api/demo-status', 15000);
  const action = useAction(status.refresh);
  const s = status.data;
  if (!s) return null;

  const t0 = s.seededAt ? new Date(s.seededAt).getTime() : 0;
  const at = (min: number) => new Date(t0 + min * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const age = t0 ? Date.now() - t0 : Infinity;

  const reset = (
    <button
      className="btn lg"
      disabled={action.running !== null}
      onClick={() => {
        if (!confirm('Reset the demo? It sets up a fresh copy on testnet and takes about 2½ minutes.')) return;
        action.run('Reset', 'reset').then(() => {
          window.location.href = '/reset';
        });
      }}
    >
      {action.running ? <Spinner /> : <Icon name="sparkle" />} Reset demo (about 2½ minutes)
    </button>
  );

  let tone: 'ok' | 'warn' = 'warn';
  let title: string;
  let detail: string;
  let needsReset = true;
  if (s.running) {
    title = 'A reset is running.';
    detail = 'A fresh copy is being set up on testnet. It takes about 2½ minutes.';
    needsReset = false;
  } else if (!s.hasCopy) {
    title = 'No demo copy yet.';
    detail = 'Set one up with the seed script (README: Run locally) or the Reset button.';
  } else if (s.payoutState === 'executed') {
    title = 'Exit day has already been played on this copy: the payout has run.';
    detail = 'Reset to start again from the beginning. The Company page still shows the finished result.';
  } else if (age > 20 * 60_000) {
    title = 'This copy is more than 20 minutes old.';
    detail = 'On the fast demo clock the shareholders’ details are now out of date, so the payout would hold most of them. Reset first.';
  } else {
    tone = 'ok';
    needsReset = false;
    title = age < 5 * 60_000 ? 'Fresh copy: start with step 1.' : 'Ready: start with step 1.';
    detail =
      age < 5 * 60_000
        ? `Set up at ${at(0)}. Maria’s bank change and the exit payout work from ${at(5)}; run the payout before about ${at(20)}.`
        : `Set up at ${at(0)}. Run the exit payout before about ${at(20)}.`;
  }

  return (
    <div className={`notice ${tone}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
      <div style={{ flex: '1 1 320px' }}>
        <strong>{s.running && <Spinner />} {title}</strong>
        <div className="small">{detail}</div>
      </div>
      {s.running ? (
        <Link href="/reset" className="btn secondary lg">See progress <Icon name="arrow" /></Link>
      ) : needsReset ? (
        reset
      ) : (
        <Link href="/reset" className="small">Reset anyway</Link>
      )}
    </div>
  );
}
