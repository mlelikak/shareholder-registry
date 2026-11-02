'use client';

import type { InboxMessage } from '@/server/store.ts';
import { Loading, usePoll } from '@/app/ui';

export default function InboxPage() {
  const inbox = usePoll<InboxMessage[]>('/api/inbox', 8000);
  if (!inbox.data) return <main><Loading error={inbox.error} /></main>;
  return (
    <main>
      <h1>Demo inbox</h1>
      <p className="lead">
        Simulated delivery: the emails and texts that would go to shareholders, so you can follow along without real email or SMS.
        The caretaker agent writes them inside the NEAR AI Cloud enclave. Code then checks each one: no technical words, no requests
        for passwords or codes, and no number that isn&apos;t in the facts.
      </p>
      {inbox.data.length === 0 && <p className="muted">No messages yet.</p>}
      {inbox.data.map((m) => (
        <div key={m.id} className={`message ${m.channel === 'text' ? 'text' : ''}`}>
          <div className="meta">
            {m.channel === 'text' ? '💬 Text' : m.channel === 'email' ? '✉️ Email' : '🔔 Alert'} to <strong>{m.toName}</strong> ·{' '}
            {new Date(m.at).toLocaleTimeString()}
          </div>
          {m.subject && <div className="subject">{m.subject}</div>}
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
        </div>
      ))}
    </main>
  );
}
