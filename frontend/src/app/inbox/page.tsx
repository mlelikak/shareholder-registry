'use client';

import type { InboxMessage } from '@/server/store.ts';
import { Loading, usePoll } from '@/app/ui';
import { MessageItem } from '@/app/inbox-dock';

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
          inbox.data.map((m) => <MessageItem key={m.id} m={m} />)
        )}
      </section>
    </main>
  );
}
