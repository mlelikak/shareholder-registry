'use client';

// The Demo inbox on every page: a corner button with a count of new
// messages, a short pop-up when an email or text arrives (so a login code
// shows up right where you are), and a slide-in panel with all messages.

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { InboxMessage } from '@/server/store.ts';
import { Avatar, Icon } from '@/app/ui';

const channelName = (m: InboxMessage) => (m.channel === 'text' ? 'Text' : m.channel === 'helper' ? 'Helper alert' : m.channel === 'letter' ? 'Letter' : 'Email');
const channelIcon = (m: InboxMessage) => (m.channel === 'text' ? 'chat' : m.channel === 'helper' ? 'alert' : 'mail');

/** One message, as shown on the Demo inbox page and in the panel. */
export function MessageItem({ m }: { m: InboxMessage }) {
  return (
    <div className={`msg ${m.channel}`}>
      <Avatar name={m.toName} />
      <div style={{ minWidth: 0 }}>
        <div className="t-meta row" style={{ gap: 6, marginBottom: 6 }}>
          <Icon name={channelIcon(m)} className="" />
          <span>
            {channelName(m)} to <strong>{m.toName}</strong> · from {m.from === 'agent' ? 'the caretaker agent' : 'the platform'} ·{' '}
            {new Date(m.at).toLocaleTimeString()}
          </span>
        </div>
        <div className="bubble">
          {m.subject && <div className="subject">{m.subject}</div>}
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
        </div>
      </div>
    </div>
  );
}

export function InboxDock() {
  const path = usePathname();
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<InboxMessage | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/inbox', { cache: 'no-store' });
        if (!r.ok) return;
        const list = (await r.json()) as InboxMessage[]; // newest first
        if (stop) return;
        if (seen.current === null) {
          // First load: what is already there is not "new".
          seen.current = new Set(list.map((m) => m.id));
        } else {
          const fresh = list.filter((m) => !seen.current!.has(m.id));
          if (fresh.length) {
            fresh.forEach((m) => seen.current!.add(m.id));
            setUnread((n) => n + fresh.length);
            setToast(fresh[0]);
            if (toastTimer.current) clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(null), 12000);
          }
          // A reset empties the inbox: start counting again.
          if (list.length === 0) setUnread(0);
        }
        setMessages(list);
      } catch {
        // The dock is a convenience; ignore a failed poll.
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The full Demo inbox page shows everything already.
  if (path === '/inbox') return null;

  const show = () => {
    setOpen(true);
    setUnread(0);
    setToast(null);
  };

  return (
    <div className="noprint">
      {toast && !open && (
        <button className="dock-toast" onClick={show} aria-live="polite">
          <span className="dock-toast-head">
            <Icon name={channelIcon(toast)} className="" /> {channelName(toast)} to <strong>{toast.toName}</strong>
            <span className="muted"> · Demo inbox</span>
          </span>
          {toast.subject && <span className="subject">{toast.subject}</span>}
          <span className="dock-toast-body">{toast.body}</span>
        </button>
      )}

      {!open && (
        <button className="dock-button" onClick={show} aria-label={`Open the demo inbox${unread ? `, ${unread} new` : ''}`}>
          <Icon name="mail" className="" /> Demo inbox
          {unread > 0 && <span className="dock-badge">{unread}</span>}
        </button>
      )}

      {open && (
        <>
          <div className="dock-backdrop" onClick={() => setOpen(false)} />
          <aside className="dock-panel" role="dialog" aria-label="Demo inbox">
            <div className="dock-panel-head">
              <div>
                <strong>Demo inbox</strong>
                <div className="small muted">The emails and texts people would receive. Simulated delivery.</div>
              </div>
              <button className="btn ghost small" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="x" className="" />
              </button>
            </div>
            <div className="dock-panel-body">
              {!messages ? (
                <p className="muted">Loading…</p>
              ) : messages.length === 0 ? (
                <p className="muted">No messages yet.</p>
              ) : (
                messages.map((m) => <MessageItem key={m.id} m={m} />)
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
