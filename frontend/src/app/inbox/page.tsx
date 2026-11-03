'use client';

import type { InboxMessage } from '@/server/store.ts';
import { Avatar, Icon, Loading, usePoll } from '@/app/ui';

export default function InboxPage() {
  const inbox = usePoll<InboxMessage[]>('/api/inbox', 8000);
  return (
    <main>
      <div className="page-head">
        <div>
          <div className="eyebrow">Demo tool · simulated delivery</div>
          <h1>Demo inbox</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            The emails and texts shareholders would receive, so you can follow along without real email or SMS. The caretaker agent writes
            its messages inside the NEAR AI Cloud enclave; code then checks each one: no technical words, no requests for passwords or codes,
            and no number that isn&apos;t in the facts.
          </p>
        </div>
      </div>
      <section className="card">
        {!inbox.data ? (
          <Loading error={inbox.error} />
        ) : inbox.data.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          inbox.data.map((m) => (
            <div key={m.id} className={`msg ${m.channel}`}>
              <Avatar name={m.toName} />
              <div style={{ minWidth: 0 }}>
                <div className="t-meta row" style={{ gap: 6, marginBottom: 6 }}>
                  <Icon name={m.channel === 'text' ? 'chat' : m.channel === 'helper' ? 'alert' : 'mail'} className="" />
                  <span>
                    {m.channel === 'text' ? 'Text' : m.channel === 'helper' ? 'Helper alert' : 'Email'} to <strong>{m.toName}</strong> · from{' '}
                    {m.from === 'agent' ? 'the caretaker agent' : 'the platform'} · {new Date(m.at).toLocaleTimeString()}
                  </span>
                </div>
                <div className="bubble">
                  {m.subject && <div className="subject">{m.subject}</div>}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
