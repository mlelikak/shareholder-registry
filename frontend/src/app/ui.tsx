'use client';

// Small shared pieces for the demo screens.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { DemoState } from '@/server/state.ts';

export type { DemoState };

const LINKS = [
  { href: '/', label: 'Start' },
  { href: '/me', label: 'Investor app' },
  { href: '/company', label: 'Company' },
  { href: '/agent', label: 'Agent log' },
  { href: '/inbox', label: 'Demo inbox' },
  { href: '/attacker', label: 'Attacker' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <Link href="/" className="brand">Shareholder Registry</Link>
      {LINKS.slice(1).map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? 'active' : ''}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** Polls a GET endpoint so the screen follows the chain without a reload. */
export function usePoll<T>(path: string, everyMs = 6000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
      setError('');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [path]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, everyMs);
    return () => clearInterval(t);
  }, [refresh, everyMs]);
  return { data, error, refresh };
}

export type ActionReply = { ok: boolean; message: string; error?: string; explorer?: string; result?: unknown };

/** Runs a POST action and keeps its result for display. */
export function useAction(onDone?: () => void) {
  const [running, setRunning] = useState<string | null>(null);
  const [reply, setReply] = useState<(ActionReply & { label: string }) | null>(null);
  const run = useCallback(
    async (label: string, action: string, body: Record<string, string> = {}) => {
      setRunning(label);
      setReply(null);
      try {
        const r = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = (await r.json()) as ActionReply;
        setReply({ ...j, label });
      } catch (e) {
        setReply({ ok: false, message: 'Request failed', error: String(e), label });
      } finally {
        setRunning(null);
        onDone?.();
      }
    },
    [onDone],
  );
  return { running, reply, run };
}

export function Reply({ reply, expectRefusal = false }: { reply: (ActionReply & { label: string }) | null; expectRefusal?: boolean }) {
  if (!reply) return null;
  const good = expectRefusal ? !reply.ok : reply.ok;
  return (
    <div className={`notice ${good ? 'ok' : 'bad'}`}>
      <strong>{reply.label}:</strong> {reply.message}
      {reply.error && <div className="small mono" style={{ marginTop: 6 }}>{reply.error}</div>}
      {reply.explorer && (
        <div className="small" style={{ marginTop: 6 }}>
          <a href={reply.explorer} target="_blank" rel="noreferrer">View the transaction on the testnet explorer ↗</a>
        </div>
      )}
    </div>
  );
}

export function StatusPill({ status }: { status: 'green' | 'amber' | 'red' }) {
  const label = { green: 'Current', amber: 'Needs a look', red: 'Needs action' }[status];
  return <span className={`pill ${status}`}><span className="dot" />{label}</span>;
}

/** Test euro has 6 decimals. */
export function euros(units: string | undefined): string {
  if (!units) return '–';
  const n = BigInt(units);
  const whole = n / 1_000_000n;
  const cents = (n % 1_000_000n) / 10_000n;
  return `€${whole.toLocaleString('en')}.${cents.toString().padStart(2, '0')}`;
}

export const ISSUE_TEXT: Record<string, string> = {
  contact_bounced: 'email bounced',
  kyc_expired: 'identity check expired',
  kyc_missing: 'no identity check',
  kyc_expiring: 'identity check expiring',
  screening_review: 'screening under review',
  never_confirmed: 'never confirmed details',
  details_stale: 'details not confirmed recently',
  share_count_unanswered: 'share count not confirmed',
  share_count_disputed: 'disputes share count',
  change_waiting: 'payout change waiting',
  paused: 'paused by the agent',
  frozen: 'frozen',
};

export function Loading({ error }: { error?: string }) {
  if (error) return <div className="notice bad">Could not load the demo: {error}</div>;
  return <p className="muted">Reading the contract on NEAR testnet…</p>;
}
