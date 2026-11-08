'use client';

// Shared pieces for the demo screens.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { DemoState } from '@/server/state.ts';

export type { DemoState };

// ---------- Icons (inline, 24px grid, stroke) ----------

const paths: Record<string, ReactNode> = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  alert: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5h.01" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 5a3.5 3.5 0 010 7M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>,
  building: <><rect x="4" y="3" width="11" height="18" rx="1" /><path d="M15 9h5v12h-5M8 7h3M8 11h3M8 15h3" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  chain: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  puzzle: <path d="M10 4h4v3a2 2 0 104 0V4h2v6h-3a2 2 0 100 4h3v6h-6v-3a2 2 0 10-4 0v3H4v-6h3a2 2 0 100-4H4V4h6z" />,
  stop: <><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5z" /><path d="M9 12h6" /></>,
  call: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z" />,
  euro: <><path d="M17 6.5A6.5 6.5 0 007 12a6.5 6.5 0 0010 5.5" /><path d="M5 10.5h8M5 13.5h8" /></>,
  bank: <path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />,
};

export function Icon({ name, className }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" className="brand-mark" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path d="M16 6.5l7.5 3.2v5.6c0 4.8-3.2 8.7-7.5 10.4-4.3-1.7-7.5-5.6-7.5-10.4V9.7L16 6.5z" fill="none" stroke="var(--panel)" strokeOpacity="0.55" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12.3 16.2l2.6 2.6 5-5.2" fill="none" stroke="var(--panel)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- Shell ----------

const MAIN = [
  { href: '/me', label: 'Investor app', icon: 'phone' },
  { href: '/company', label: 'Company', icon: 'building' },
  { href: '/agent', label: 'Agent log', icon: 'bot' },
];
const DEMO = [
  { href: '/inbox', label: 'Demo inbox', icon: 'mail' },
  { href: '/attacker', label: 'Attacker', icon: 'shield' },
  { href: '/estate', label: 'Estate review', icon: 'users' },
  { href: '/reset', label: 'Reset', icon: 'sparkle' },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <BrandMark />
          <span>
            Mnemon
            <small>Payment agent for exit day</small>
          </span>
        </Link>
        <nav className="tabs">
          {MAIN.map((l) => (
            <Link key={l.href} href={l.href} className={`tab ${path === l.href ? 'active' : ''}`}>
              <Icon name={l.icon} />
              {l.label}
            </Link>
          ))}
          <span className="sep" />
          {DEMO.map((l) => (
            <Link key={l.href} href={l.href} className={`tab demo ${path === l.href ? 'active' : ''}`}>
              <Icon name={l.icon} />
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

// ---------- Data ----------

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
      <strong>{expectRefusal && !reply.ok ? 'Refused. ' : ''}</strong>
      {expectRefusal && !reply.ok ? 'The contract said:' : reply.message}
      {reply.error && <span className="mono">{reply.error}</span>}
      {reply.explorer && (
        <div className="small" style={{ marginTop: 6 }}>
          <a href={reply.explorer} target="_blank" rel="noreferrer">View on the testnet explorer ↗</a>
        </div>
      )}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function StatusPill({ status }: { status: 'green' | 'amber' | 'red' }) {
  const label = { green: 'Current', amber: 'Needs a look', red: 'Needs action' }[status];
  return <span className={`pill ${status}`}><span className="dot" />{label}</span>;
}

/** Funds and other institutions get a square mark; people a round one. */
export const isFund = (name: string) => /\b(Ventures|Capital|Fund|Partners|Holdings)\b/.test(name);

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  const words = name.replace(/['’]s\b/g, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  const initials = ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  return <span className={`avatar ${size ?? ''} ${isFund(name) ? 'fund' : ''}`}>{initials || '?'}</span>;
}

/** Test euro has 6 decimals. */
export function euros(units: string | undefined): string {
  if (!units) return '–';
  const n = BigInt(units);
  const whole = n / 1_000_000n;
  const cents = (n % 1_000_000n) / 10_000n;
  return `€${whole.toLocaleString('en')}.${cents.toString().padStart(2, '0')}`;
}

/** Most important first; the register shows the first one. */
export const ISSUE_ORDER = [
  'frozen', 'share_count_disputed', 'contact_bounced', 'kyc_expired', 'kyc_missing', 'screening_review', 'paused',
  'share_count_unanswered', 'never_confirmed', 'details_stale', 'change_waiting', 'kyc_expiring',
];

export const ISSUE_TEXT: Record<string, string> = {
  contact_bounced: 'Email bounced',
  kyc_expired: 'Identity check expired',
  kyc_missing: 'No identity check',
  kyc_expiring: 'Identity check expiring',
  screening_review: 'Screening under review',
  never_confirmed: 'Never confirmed details',
  details_stale: 'Details not confirmed recently',
  share_count_unanswered: "Hasn't confirmed share count",
  share_count_disputed: 'Disputes share count',
  change_waiting: 'Payout change waiting',
  paused: 'Paused by the agent',
  frozen: 'Frozen',
};

export function sortIssues(issues: string[]) {
  return [...issues].sort((a, b) => ISSUE_ORDER.indexOf(a) - ISSUE_ORDER.indexOf(b));
}

export function Loading({ error }: { error?: string }) {
  if (error) return <div className="notice bad">Could not load the demo: {error}</div>;
  return (
    <p className="muted row">
      <Spinner /> Reading the contract on NEAR testnet…
    </p>
  );
}
