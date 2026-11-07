'use client';

// Investor and helper screens (DESIGN.md section 9): large text, one decision
// per screen, plain words, no countdown pressure, "Call us" always visible.

import { useCallback, useEffect, useState } from 'react';
import { Avatar, euros, Icon, Spinner } from '@/app/ui';

type Person = { key: string; name: string; phoneEnd: string; helperOf?: string };
type Pending = { method: string; effective_at: number; extended: boolean; bankLast4?: string };
type InvestorView = {
  loggedIn: true;
  role: 'investor';
  key: string;
  name: string;
  phoneEnd: string;
  status: 'green' | 'amber' | 'red' | null;
  state?: string;
  contactBounced: boolean;
  kycExpired: boolean;
  detailsOld: boolean;
  payoutMethod?: 'near' | 'intents' | 'bank';
  bankLast4?: string;
  route?: { chain: string; asset_id: string; address: string } | null;
  pendingChange: Pending | null;
  helpers: string[];
  company: { name: string; totalShares: number };
  event: {
    state: string;
    sharesOnRecord?: number;
    confirmation: 'unconfirmed' | 'confirmed' | { disputed: { shares: number } };
    line?: { shares: number; amount: string; outcome: string };
    manifestRoot: string | null;
  } | null;
  held: string;
};
type HelperView = {
  loggedIn: true;
  role: 'helper';
  key: string;
  name: string;
  helperOf: { key: string; name: string };
  isHelperOnChain: boolean;
  pendingChange: Pending | null;
  currentBankLast4?: string;
};
type View = InvestorView | HelperView | { loggedIn: false };
type Reply = { ok: boolean; message: string; error?: string; explorer?: string; feePaidByPlatform?: boolean; data?: Record<string, unknown> };

async function post(op: string, body: Record<string, string> = {}): Promise<Reply> {
  const r = await fetch(`/api/me/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function CallUs() {
  return (
    <div className="callus noprint">
      <Icon name="call" />
      <span>Questions? <strong>Call us: 0800 000 000</strong> <span className="small">(simulated)</span></span>
    </div>
  );
}

function Done({ reply }: { reply: Reply | null }) {
  if (!reply) return null;
  return (
    <div className={`notice ${reply.ok ? 'ok' : 'bad'}`}>
      {reply.message}
      {reply.error && <div className="small muted">{reply.error}</div>}
      {reply.explorer && (
        <div className="small">
          <a href={reply.explorer} target="_blank" rel="noreferrer">Recorded on NEAR testnet ↗</a>
          {reply.feePaidByPlatform && <span className="muted"> · No fee for you: the platform paid it.</span>}
        </div>
      )}
    </div>
  );
}

// ---------- Login (simulated) ----------

const ROLES: Record<string, string> = {
  maria: 'Shareholder, 72 · target of a scam call',
  tom: 'Shareholder · his email bounced',
  peter: 'Shareholder · identity check expired',
  lena: 'Shareholder · bought 200 shares from Peter',
  erik: 'Shareholder · everything in order',
  anna: "Maria's daughter · trusted helper",
};

function Login({ onDone }: { onDone: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [who, setWho] = useState<Person | null>(null);
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    fetch('/api/me/people').then((r) => r.json()).then(setPeople);
  }, []);
  if (!who)
    return (
      <>
        <h1>Who are you?</h1>
        <p className="notice warn small">Simulated login: choose a person from the demo. In the real app you log in with your email or phone.</p>
        <div className="people">
          {people.map((p) => (
            <button key={p.key} className="person" onClick={async () => {
              setWho(p);
              const r = await post('send-code', { key: p.key });
              setHint(String(r.data?.code ?? ''));
            }}>
              <Avatar name={p.name} />
              <span>
                <strong>{p.name}</strong>
                <span className="role" style={{ display: 'block' }}>{ROLES[p.key] ?? (p.helperOf ? 'Trusted helper' : 'Shareholder')}</span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
  return (
    <>
      <h1>Hello {who.name}</h1>
      <p>We sent a 6-digit code to your phone ending <strong>{who.phoneEnd}</strong>.</p>
      <p className="small muted">Demo: the text is in the Demo inbox. Your code is <strong className="mono">{hint}</strong>.</p>
      <label className="field">
        Code
        <input inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
      </label>
      <div className="stack">
        <button className="btn big" onClick={async () => {
          const r = await post('login', { key: who.key, code });
          if (r.ok) onDone();
          else setMsg(r.message);
        }}>Log in</button>
        <button className="btn big secondary" onClick={() => setWho(null)}>Back</button>
      </div>
      {msg && <div className="notice bad">{msg}</div>}
    </>
  );
}

// ---------- Investor ----------

function payTo(v: InvestorView) {
  if (v.payoutMethod === 'bank') return `Bank account ending ${v.bankLast4 ?? '••••'}`;
  if (v.payoutMethod === 'intents' && v.route) return `${v.route.asset_id.toUpperCase()} on ${v.route.chain[0].toUpperCase()}${v.route.chain.slice(1)}`;
  return 'Euros to your account here';
}

function ChangeBank({ v, onExit }: { v: InvestorView; onExit: () => void }) {
  const [step, setStep] = useState<'safety' | 'stop' | 'bank' | 'code' | 'done'>('safety');
  const [last4, setLast4] = useState('');
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [effective, setEffective] = useState<Pending | null>(null);

  if (step === 'safety')
    return (
      <>
        <h1>Has anyone asked you to change this?</h1>
        <p className="big-text">
          We will <strong>never</strong> call, text or email you asking you to change your bank account. If someone did, stop here and
          call your helper or us.
        </p>
        <div className="stack">
          <button className="btn big" onClick={() => setStep('bank')}>No, this is my own decision</button>
          <button className="btn big danger" onClick={() => setStep('stop')}>Someone asked me — stop</button>
        </div>
      </>
    );
  if (step === 'stop')
    return (
      <>
        <h1>Thank you for stopping</h1>
        <p className="big-text">Nothing has been changed. Please call us or your helper{v.helpers.length ? ` (${v.helpers.join(', ')})` : ''} and tell them what happened. You did the right thing.</p>
        <button className="btn big" onClick={onExit}>Back to my page</button>
      </>
    );
  if (step === 'bank')
    return (
      <>
        <h1>Confirm the new account is yours</h1>
        <p className="notice warn small">Simulated: in the real app you log in to your bank here, and it confirms the account belongs to you. No account number is stored on-chain.</p>
        <label className="field">
          Last 4 digits of your new account
          <input inputMode="numeric" value={last4} onChange={(e) => setLast4(e.target.value)} maxLength={4} />
        </label>
        <div className="stack">
          <button className="btn big" disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await post('bank-verify', { last4 });
            setBusy(false);
            setReply(r.ok ? null : r);
            if (r.ok) {
              const c = await post('send-code', { key: v.key });
              setHint(String(c.data?.code ?? ''));
              setStep('code');
            }
          }}>{busy ? 'Checking with your bank…' : 'Continue to my bank'}</button>
          <button className="btn big secondary" onClick={onExit}>Cancel</button>
        </div>
        <Done reply={reply} />
      </>
    );
  if (step === 'code')
    return (
      <>
        <h1>Final security check</h1>
        <p className="big-text">We&apos;ve sent a 6-digit code to your phone ending <strong>{v.phoneEnd}</strong>.</p>
        <p className="small muted">Demo: your code is <strong className="mono">{hint}</strong> (also in the Demo inbox).</p>
        <label className="field">
          Code
          <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
        </label>
        <div className="stack">
          <button className="btn big" disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await post('bank-request', { code });
            setReply(r);
            if (r.ok) {
              const view = (await fetch('/api/me/view').then((x) => x.json())) as InvestorView;
              setEffective(view.pendingChange);
              setStep('done');
            }
            setBusy(false);
          }}>{busy ? 'Saving…' : 'Confirm'}</button>
          <button className="btn big secondary" onClick={onExit}>Cancel</button>
        </div>
        <Done reply={reply && !reply.ok ? reply : null} />
      </>
    );
  return (
    <div className="printable">
      <h1>✓ Your change is saved</h1>
      {effective && (
        <p className="big-text">
          Your new account ending <strong>{effective.bankLast4}</strong> will be used from <strong>{when(effective.effective_at)}</strong>.
        </p>
      )}
      {effective?.extended && (
        <p className="notice warn">
          For your safety this takes longer than usual, because your contact details changed recently. (Demo clock: 5 minutes. In real
          life: 14 days.)
        </p>
      )}
      <p className="big-text">
        {v.helpers.length ? `We've told ${v.helpers.join(' and ')} (your helper). ` : ''}If you didn&apos;t ask for this, tap Cancel or call
        us.
      </p>
      {reply?.explorer && <p className="small"><a href={reply.explorer} target="_blank" rel="noreferrer">Recorded on NEAR testnet ↗</a></p>}
      <div className="stack noprint">
        <button className="btn big secondary" onClick={() => window.print()}>Print this confirmation</button>
        <button className="btn big" onClick={onExit}>Back to my page</button>
      </div>
    </div>
  );
}

function Investor({ v, refresh }: { v: InvestorView; refresh: () => Promise<void> }) {
  const [screen, setScreen] = useState<'home' | 'bank' | 'id' | 'count' | 'check'>('home');
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [shares, setShares] = useState('');
  const run = useCallback(async (label: string, op: string, body: Record<string, string> = {}) => {
    setBusy(label);
    setReply(null);
    const r = await post(op, body);
    setReply(r);
    await refresh();
    setBusy(null);
    return r;
  }, [refresh]);

  if (screen === 'bank') return <ChangeBank v={v} onExit={() => { setScreen('home'); refresh(); }} />;

  if (screen === 'id')
    return (
      <>
        <h1>Identify yourself again</h1>
        <p className="notice warn small">Simulated strong identification: in the real app you confirm who you are with your usual identification, through a licensed partner.</p>
        <p className="big-text">It takes a few minutes, and then your identity check is valid for another year.</p>
        <div className="stack">
          <button className="btn big" disabled={!!busy} onClick={async () => {
            const r = await run('id', 'reidentify');
            if (r.ok) setScreen('home');
          }}>{busy ? 'Checking…' : 'Identify me'}</button>
          <button className="btn big secondary" onClick={() => setScreen('home')}>Not now</button>
        </div>
        <Done reply={reply} />
      </>
    );

  if (screen === 'count')
    return (
      <>
        <h1>How many shares do you hold?</h1>
        <p className="big-text">Our records say {v.event?.sharesOnRecord?.toLocaleString('en')}. Please enter the number you believe is right.</p>
        <label className="field">
          Number of shares
          <input inputMode="numeric" value={shares} onChange={(e) => setShares(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="stack">
          <button className="btn big" disabled={!!busy || !shares} onClick={async () => {
            const r = await run('count', 'confirm-holding', { shares });
            if (r.ok) setScreen('home');
          }}>{busy ? 'Sending…' : 'Send'}</button>
          <button className="btn big secondary" onClick={() => setScreen('home')}>Back</button>
        </div>
        <Done reply={reply} />
      </>
    );

  if (screen === 'check') {
    const d = reply?.data as { shares: number; amount: string } | undefined;
    return (
      <>
        <h1>Check this payment</h1>
        {!reply ? (
          <p>Checking…</p>
        ) : reply.ok && d ? (
          <p className="big-text">
            ✓ Your <strong>{euros(d.amount)}</strong> matches your <strong>{d.shares.toLocaleString('en')}</strong> of {v.company.name}&apos;s{' '}
            {v.company.totalShares.toLocaleString('en')} shares, and it is part of the same calculation every shareholder was paid by.
          </p>
        ) : (
          <Done reply={reply} />
        )}
        <p className="small muted">
          How this works: when the payout ran, the contract published a fingerprint (a Merkle root) of every holder&apos;s line before any
          money moved. Your line, plus a short proof, has to match that fingerprint, so nobody could have changed your amount afterwards.
        </p>
        <button className="btn big" onClick={() => { setScreen('home'); setReply(null); }}>Back to my page</button>
      </>
    );
  }

  const ev = v.event;
  const open = ev && ev.state !== 'executed';
  const disputed = ev && typeof ev.confirmation === 'object';
  const needsDetails = v.contactBounced || v.detailsOld || v.state === 'paused';
  const heldAmount = BigInt(v.held || '0');
  const line = ev?.line;

  return (
    <>
      <h1>Hello {v.name}.</h1>
      {v.status === 'green' && !needsDetails && !v.kycExpired ? (
        <div className="status-hero good-bg"><span className="good"><Icon name="check" /></span><div><strong>Your details are up to date.</strong><div className="small">Nothing to do right now.</div></div></div>
      ) : (
        <div className="status-hero todo-bg"><span style={{ color: 'var(--amber)' }}><Icon name="alert" /></span><div><strong>{[needsDetails, v.kycExpired, ev?.confirmation === 'unconfirmed' && (open || heldAmount > 0n)].filter(Boolean).length > 1 ? 'A few things need you' : 'One thing needs you'}</strong><div className="small">It only takes a moment. See below.</div></div></div>
      )}
      <div className="tile" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Icon name={v.payoutMethod === 'bank' ? 'bank' : 'euro'} className="" />
        <div><div className="small muted">Payments go to</div><strong>{payTo(v)}</strong></div>
      </div>

      {v.pendingChange && (
        <div className="tile">
          <h2>A change is waiting</h2>
          <p>
            Your new account {v.pendingChange.bankLast4 ? `ending ${v.pendingChange.bankLast4} ` : ''}will be used from{' '}
            <strong>{when(v.pendingChange.effective_at)}</strong>. Until then, payments go to your current account.
          </p>
          <button className="btn big secondary" disabled={!!busy} onClick={() => run('cancel', 'cancel-change')}>Cancel this change</button>
        </div>
      )}

      {ev && ev.confirmation === 'unconfirmed' && (open || heldAmount > 0n) && (
        <div className="tile">
          <h2>{open ? `${v.company.name} is about to pay its shareholders.` : `Before we send your money from ${v.company.name}:`}</h2>
          <p className="big-text">Our records show you hold <strong>{ev.sharesOnRecord?.toLocaleString('en')} shares</strong>. Is that right?</p>
          <div className="stack">
            <button className="btn big" disabled={!!busy} onClick={() => run('yes', 'confirm-holding', { shares: String(ev.sharesOnRecord) })}>
              {busy === 'yes' ? 'Sending…' : "Yes, that's right"}
            </button>
            <button className="btn big secondary" onClick={() => setScreen('count')}>No, I hold a different number</button>
          </div>
        </div>
      )}
      {ev && disputed && (
        <div className="tile">
          <h2>Thank you for telling us</h2>
          <p>You told us you hold {(ev.confirmation as { disputed: { shares: number } }).disputed.shares.toLocaleString('en')} shares. We are looking into it and will ask you to confirm once it is corrected. Your money is safe in the meantime.</p>
        </div>
      )}
      {open && ev?.confirmation === 'confirmed' && <p className="good">✓ You confirmed your {ev.sharesOnRecord?.toLocaleString('en')} shares for {v.company.name}&apos;s payout.</p>}

      {v.kycExpired && (
        <div className="tile">
          <h2>Your identity check has expired</h2>
          <p>Before we can pay you, please identify yourself again. It takes a few minutes.</p>
          <button className="btn big" onClick={() => setScreen('id')}>Identify me again</button>
        </div>
      )}

      {needsDetails && (
        <div className="tile">
          <h2>Are your details still correct?</h2>
          <p>
            Payments go to {payTo(v).toLowerCase().startsWith('euros') ? 'your account here' : payTo(v)} · Phone ending {v.phoneEnd}
          </p>
          <button className="btn big" disabled={!!busy} onClick={() => run('details', 'confirm-details')}>{busy === 'details' ? 'Saving…' : 'Yes, all correct'}</button>
        </div>
      )}

      {line && line.outcome === 'paid' && v.payoutMethod === 'intents' && v.route && (
        <div className="tile">
          <h2>{euros(line.amount)} from {v.company.name} was sent to you as {payTo(v)}.</h2>
          <p>
            It went to your address ending {v.route.address.slice(-4)} through NEAR Intents. (Demo: the delivery to {payTo(v)} is
            simulated; the amount is in test euros on NEAR testnet.)
          </p>
          <button className="btn big secondary" onClick={async () => { setScreen('check'); setReply(await post('check-payment')); }}>Check this payment</button>
        </div>
      )}
      {line && line.outcome === 'paid' && v.payoutMethod !== 'intents' && (
        <div className="tile">
          <h2>{euros(line.amount)} received from {v.company.name}.</h2>
          <p>It&apos;s in your account now. (Test euros on NEAR testnet.)</p>
          <button className="btn big secondary" onClick={async () => { setScreen('check'); setReply(await post('check-payment')); }}>Check this payment</button>
        </div>
      )}
      {line && line.outcome === 'queued' && (
        <div className="tile">
          <h2>{euros(line.amount)} from {v.company.name} is on its way to your bank account ending {v.bankLast4}.</h2>
          <p>Banks can take a day or two. (Bank delivery is simulated in the demo.)</p>
          <button className="btn big secondary" onClick={async () => { setScreen('check'); setReply(await post('check-payment')); }}>Check this payment</button>
        </div>
      )}
      {heldAmount > 0n && line && (
        <div className="tile">
          <h2>{euros(v.held)} from {v.company.name} is waiting for you.</h2>
          <p>We kept it safe because we couldn&apos;t pay you yet. Once the steps above are done, you can collect it.</p>
          <div className="stack">
            <button className="btn big" disabled={!!busy} onClick={() => run('claim', 'claim')}>{busy === 'claim' ? 'Sending…' : 'Collect my money'}</button>
            <button className="btn big secondary" onClick={async () => { setScreen('check'); setReply(await post('check-payment')); }}>Check this payment</button>
          </div>
        </div>
      )}

      <Done reply={screen === 'home' ? reply : null} />

      <h2>Something changed?</h2>
      <div className="stack">
        <button className="btn big secondary" disabled={!!v.pendingChange || v.state !== 'active'} onClick={() => setScreen('bank')}>Change my bank account</button>
        <button className="btn big secondary" disabled={!!busy} onClick={() => run('phone', 'new-phone')}>I have a new phone number</button>
      </div>
    </>
  );
}

// ---------- Helper ----------

function Helper({ v, refresh }: { v: HelperView; refresh: () => Promise<void> }) {
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [fine, setFine] = useState(false);
  const p = v.pendingChange;
  return (
    <>
      <h1>Hello {v.name}.</h1>
      <p className="big-text">You are {v.helperOf.name}&apos;s trusted helper. You can stop changes {v.helperOf.name} didn&apos;t really want. You can&apos;t make changes or receive money.</p>
      {!v.isHelperOnChain && <p className="notice warn">Your helper role starts shortly: adding a helper also has a waiting period.</p>}
      {p && !fine ? (
        <div className="tile">
          <h2>{v.helperOf.name} asked to change the bank account for payouts{p.bankLast4 ? ` to one ending ${p.bankLast4}` : ''}.</h2>
          <p className="big-text">It takes effect on <strong>{when(p.effective_at)}</strong>.</p>
          <div className="stack">
            <button className="btn big secondary" onClick={() => setFine(true)}>That&apos;s fine</button>
            <button className="btn big danger" disabled={busy} onClick={async () => {
              setBusy(true);
              const r = await post('helper-cancel');
              setReply(r);
              await refresh();
              setBusy(false);
            }}>{busy ? 'Cancelling…' : 'Cancel this change'}</button>
          </div>
        </div>
      ) : (
        <p className="big-text good">{fine ? 'Thank you. Nothing else to do.' : `Nothing needs your attention. ${v.helperOf.name}'s payouts go to the account ending ${v.currentBankLast4}.`}</p>
      )}
      <Done reply={reply} />
    </>
  );
}

export default function Me() {
  const [view, setView] = useState<View | null>(null);
  const refresh = useCallback(async () => {
    setView(await fetch('/api/me/view', { cache: 'no-store' }).then((r) => r.json()));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return (
    <main>
      <div className="phone-stage">
        <div className="phone">
          <div className="phone-bar noprint">
            {view?.loggedIn ? <Avatar name={view.name} /> : <Icon name="shield" className="" />}
            <span className="title">{view?.loggedIn ? view.name : 'Your shares'}</span>
            {view?.loggedIn && (
              <button className="btn ghost small" onClick={async () => { await post('logout'); refresh(); }}>Log out</button>
            )}
          </div>
          <div className="phone-body">
            {!view ? (
              <p className="row"><Spinner /> Loading…</p>
            ) : !view.loggedIn ? (
              <Login onDone={refresh} />
            ) : view.role === 'helper' ? (
              <Helper v={view} refresh={refresh} />
            ) : (
              <Investor v={view} refresh={refresh} />
            )}
          </div>
          <CallUs />
        </div>
      </div>
    </main>
  );
}
