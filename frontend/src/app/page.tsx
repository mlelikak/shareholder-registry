import Link from 'next/link';
import { Icon } from '@/app/ui';

const STEPS = [
  { href: '/company', title: 'Get the company ready to pay', text: 'Run the caretaker agent. It finds who needs to act and spots a share transfer the register never recorded.' },
  { href: '/me', title: 'Answer as a shareholder', text: 'Log in as Peter, Lena or Tom: confirm a share count, renew an identity check, collect held money.' },
  { href: '/company', title: 'Run the exit payout', text: 'The contract checks everything, publishes a proof, then pays. Anyone not ready is held, never lost.' },
  { href: '/attacker', title: 'Try to steal a payout', text: 'A stranger, the company itself and a fooled AI agent each try to redirect Maria’s money.' },
];

export default function Start() {
  return (
    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">Exit day for a company with hundreds of small investors</div>
          <h1>Pay every shareholder exactly right, without the phone calls.</h1>
          <p className="lead">
            Each investor&apos;s payout details are verified, current and controlled only by them. An AI caretaker agent does the legwork
            but can&apos;t touch the money, and the contract proves every payout matched each holder&apos;s shares.
          </p>
          <div className="row">
            <Link href="/company" className="btn lg">Start the demo <Icon name="arrow" /></Link>
            <Link href="/me" className="btn lg secondary">Open the investor app</Link>
          </div>
        </div>
        <div className="card">
          <div className="facts">
            <div className="fact"><Icon name="shield" /><div><strong>Only the investor can change where money goes.</strong><div className="small muted">Not the company, not the platform, not the AI. The contract enforces it.</div></div></div>
            <div className="fact"><Icon name="lock" /><div><strong>The AI runs privately.</strong><div className="small muted">Inside an attested Intel TDX and NVIDIA enclave on NEAR AI Cloud.</div></div></div>
            <div className="fact"><Icon name="check" /><div><strong>Every payout is provably right.</strong><div className="small muted">Integer arithmetic in the contract, and a proof published before money moves.</div></div></div>
            <div className="fact"><Icon name="users" /><div><strong>No names on-chain.</strong><div className="small muted">Shareholders appear only as random accounts.</div></div></div>
          </div>
        </div>
      </section>

      <h2>The demo in four steps</h2>
      <div className="steps">
        {STEPS.map((s, i) => (
          <Link key={s.title} href={s.href} className="card step">
            <div className="num">{i + 1}</div>
            <h3>{s.title}</h3>
            <p className="small muted" style={{ margin: 0 }}>{s.text}</p>
          </Link>
        ))}
      </div>

      <h2 style={{ marginTop: 36 }}>What is real and what is simulated</h2>
      <div className="grid cols-2">
        <div className="card flat">
          <div className="card-head"><div className="card-icon"><Icon name="check" /></div><h3>Real</h3></div>
          <p className="small" style={{ margin: 0 }}>
            On NEAR testnet: the registry contract, share counts, confirmations and disputes, the checks before paying, the payout in a test
            euro token, held funds, the restricted keys, and the platform paying investors&apos; fees through meta transactions. On NEAR AI Cloud: the agent&apos;s model, in an attested enclave.
          </p>
        </div>
        <div className="card flat">
          <div className="card-head"><div className="card-icon red"><Icon name="sparkle" /></div><h3>Simulated, and labelled where it appears</h3></div>
          <p className="small" style={{ margin: 0 }}>
            Logins, email and text delivery, identity checks (KYC) and bank verification. Test euros are not real money.
          </p>
        </div>
      </div>
    </main>
  );
}
