import Link from 'next/link';
import { Icon } from '@/app/ui';

const PRINCIPLES = [
  {
    icon: 'shield',
    title: 'Only the investor can change where money goes',
    text: 'Not the company, not the platform, not the AI. Every change is signed by the investor, waits, and alerts a trusted helper. The contract enforces it.',
  },
  {
    icon: 'bot',
    title: 'An AI agent that can’t touch the money',
    text: 'It reconciles the register, chases missing answers and explains delays, privately inside an attested NEAR AI Cloud enclave. Its key can only flag, pause and log.',
  },
  {
    icon: 'check',
    title: 'Every payout provably right',
    text: 'The contract does the arithmetic and refuses to pay unless every check passes. A proof is published before any money moves, and each investor can check their own line.',
  },
];

const STEPS = [
  { href: '/company', title: 'Get ready', text: 'Run the caretaker agent. It finds who must act and spots a share transfer the register never recorded.' },
  { href: '/me', title: 'Answer as a shareholder', text: 'Confirm a share count, renew an identity check, collect held money.' },
  { href: '/attacker', title: 'Try to steal a payout', text: 'A stranger, the company and a fooled AI each try to redirect a payout. All are refused.' },
  { href: '/company', title: 'Pay everyone', text: 'One click. Anyone not ready is held, never lost, until they are back.' },
];

const PREVIEW = [
  { name: 'Larkspur Ventures', fund: true, shares: '12,000', state: 'Paid' },
  { name: 'Quarry Hill Capital', fund: true, shares: '8,000', state: 'Paid' },
  { name: 'Maria Keller', shares: '1,000', state: 'Paid to bank' },
  { name: 'Lena Ortiz', shares: '1,200', state: 'Paid via Intents' },
  { name: 'Tom Hartley', shares: '1,000', state: 'Held for him', held: true },
];

const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('');

/** A drawn preview of the payout dashboard (static; the live one is on the Company page). */
function Preview() {
  return (
    <div className="hp-preview" aria-label="Preview of the exit payout dashboard">
      <div className="hp-preview-head">
        <span className="small muted">Acme · Exit payout</span>
        <span className="hp-chip"><Icon name="lock" /> Proof published</span>
      </div>
      <div className="hp-preview-num">
        6<span> of 7 paid</span>
      </div>
      <div className="hp-preview-bar">
        {[1, 1, 1, 1, 1, 1, 0].map((on, i) => (
          <span key={i} className={on ? 'on' : ''} />
        ))}
      </div>
      <div className="hp-preview-rows">
        {PREVIEW.map((r) => (
          <div key={r.name} className="hp-preview-row">
            <span className={`avatar ${r.fund ? 'fund' : ''}`}>{initials(r.name)}</span>
            <span className="hp-name">{r.name}</span>
            <span className="hp-shares">{r.shares}</span>
            <span className={`hp-state ${r.held ? 'held' : ''}`}>{r.held ? null : <Icon name="check" />}{r.state}</span>
          </div>
        ))}
      </div>
      <div className="hp-preview-foot small muted">Checks passed · amounts by the contract, not the AI</div>
    </div>
  );
}

export default function Start() {
  return (
    <main className="hp">
      <section className="hp-hero">
        <div>
          <div className="eyebrow">Exit-day payouts on NEAR</div>
          <h1>
            <span className="hp-h1-line">Pay every shareholder</span> <span className="hp-h1-line">exactly right.</span>{' '}
            <span className="hp-h1-line hp-h1-soft">No phone calls.</span>
          </h1>
          <p className="hp-lead">
            When a company with hundreds of small investors is sold, every one of them has to be found, verified and paid. This registry keeps
            each investor&apos;s payout details verified and under their own control, and proves every payout matched their shares.
          </p>
          <div className="row" style={{ gap: 12 }}>
            <Link href="/company" className="btn lg">
              Start the demo <Icon name="arrow" />
            </Link>
            <Link href="/me" className="btn lg secondary">
              Open the investor app
            </Link>
          </div>
          <p className="tiny muted" style={{ marginTop: 14 }}>Live on NEAR testnet with test euros. Logins, emails and identity checks are simulated.</p>
        </div>
        <Preview />
      </section>

      <section className="hp-principles">
        {PRINCIPLES.map((p) => (
          <div key={p.title} className="hp-principle">
            <span className="hp-icon"><Icon name={p.icon} /></span>
            <h3>{p.title}</h3>
            <p className="muted">{p.text}</p>
          </div>
        ))}
      </section>

      <section className="hp-section">
        <div className="hp-section-head">
          <h2>The demo</h2>
          <p className="muted">About five minutes. Start with Reset if someone has used it before you.</p>
        </div>
        <ol className="hp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Link href={s.href} className="hp-step">
                <span className="hp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="hp-step-title">{s.title} <Icon name="arrow" /></span>
                <span className="small muted">{s.text}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="hp-section hp-split">
        <div>
          <h2>What is real</h2>
          <ul className="hp-list">
            <li>The registry contract on NEAR testnet: who may change what, waiting periods, helper cancels</li>
            <li>Share-count confirmations, disputes, the checks before paying and the published proof</li>
            <li>Payouts in a test euro token, held money and claims, restricted keys for every role</li>
            <li>The platform paying investors&apos; fees through meta transactions</li>
            <li>The agent&apos;s model on NEAR AI Cloud, with its enclave attestation checked</li>
          </ul>
        </div>
        <div>
          <h2>What is simulated</h2>
          <ul className="hp-list muted-list">
            <li>Logins, emails and text messages (see the Demo inbox)</li>
            <li>Identity checks (KYC) and bank verification</li>
            <li>Bank transfers and the delivery of cross-chain payouts</li>
            <li>Test euros are not real money</li>
          </ul>
        </div>
      </section>

      <section className="hp-built">
        <span className="tiny muted">Built on</span>
        <span>NEAR testnet</span>
        <span>NEAR AI Cloud</span>
        <span>NEAR Intents</span>
        <span>Meta transactions</span>
        <span>Function-call keys</span>
      </section>
    </main>
  );
}
