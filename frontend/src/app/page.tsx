import Link from 'next/link';

const card = { textDecoration: 'none', color: 'inherit' } as const;

export default function Start() {
  return (
    <main>
      <h1>Exit day, without the phone calls</h1>
      <p className="lead">
        A company with hundreds of small investors is being sold, and someone has to pay every one of them. Here each investor&apos;s
        payout details are verified, current and controlled only by the investor. A caretaker agent does the legwork but can&apos;t touch
        the money, and the contract proves every payout matched each holder&apos;s shares.
      </p>

      <div className="grid cols-2">
        <Link href="/company" className="panel" style={card}>
          <h3>1. Company: payout readiness →</h3>
          <p className="small muted">Run the caretaker agent, apply its correction for an unrecorded share transfer, and run the exit payout.</p>
        </Link>
        <Link href="/agent" className="panel" style={card}>
          <h3>2. Agent log →</h3>
          <p className="small muted">What the agent did and why, with proof its AI ran inside an attested enclave on NEAR AI Cloud.</p>
        </Link>
        <Link href="/inbox" className="panel" style={card}>
          <h3>3. Demo inbox →</h3>
          <p className="small muted">The emails and texts the agent sent to shareholders (simulated delivery).</p>
        </Link>
        <Link href="/attacker" className="panel" style={card}>
          <h3>4. Attacker panel →</h3>
          <p className="small muted">A stranger, the company itself and a fooled AI agent each try to redirect a payout.</p>
        </Link>
      </div>

      <h2>What is real and what is simulated</h2>
      <div className="panel small">
        <p style={{ marginTop: 0 }}>
          <strong>Real, on NEAR testnet:</strong> the registry contract, share counts, confirmations and disputes, the checks before paying,
          the payout in a test euro token, held funds, and the restricted keys. <strong>Real, on NEAR AI Cloud:</strong> the agent&apos;s
          model, running in an attested Intel TDX and NVIDIA enclave.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Simulated:</strong> logins, email and text delivery, identity checks (KYC) and bank verification. Test euros are not real
          money.
        </p>
      </div>
    </main>
  );
}
