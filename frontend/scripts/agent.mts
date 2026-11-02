// Runs the caretaker agent against the seeded demo from the command line.
// Usage (from frontend/): node scripts/agent.mts run | fraud

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { runAgent } from '../src/server/agent/run.ts';
import { fraudScene } from '../src/server/agent/fraud.ts';
import { loadDeployment, loadInbox } from '../src/server/store.ts';
import { txLink } from '../src/server/near.ts';

const envFile = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const d = loadDeployment();
const what = process.argv[2] ?? 'run';

if (what === 'run') {
  const r = await runAgent(d);
  console.log(`== readiness: ${r.readiness.ready} of ${r.readiness.total} ready`, JSON.stringify(r.readiness.counts));
  for (const f of r.findings) console.log(`   ${f.name.padEnd(6)} ${f.status.padEnd(5)} ${f.ready ? 'ready' : '     '} ${f.issues.join(', ')}`);
  console.log('\n== report (written by the enclave model)\n' + r.report);
  for (const p of r.proposals) console.log(`\n== proposal ${p.pattern}: ${JSON.stringify(p.corrections.map((c) => c.shares))}\n${p.explanation}`);
  console.log(`\n== ${r.messages} messages to the demo inbox`);
  for (const m of loadInbox().slice(-r.messages)) console.log(`-- ${m.channel} to ${m.toName}${m.subject ? ` | ${m.subject}` : ''}\n${m.body}`);
  console.log('\n== on-chain, with the restricted key');
  for (const a of r.chainActions) console.log(`${a.ok ? 'ok  ' : 'FAIL'} ${a.method} ${a.holder} ${a.ok ? txLink(a.txHash) : a.error}`);
  console.log('\n== enclave');
  for (const p of r.proofs) console.log(`reply ${p.chatId}: hashes match ${p.hashesMatch}, signature valid ${p.signatureValid}, key ${p.signingAddress}, attested ${p.attested}`);
  for (const a of r.attestation) console.log(`quote v${a.quoteVersion} type ${a.teeType}: key in quote ${a.keyInQuote}, our nonce in quote ${a.nonceInQuote}, NVIDIA evidence ${a.nvidiaEvidence}`);
} else if (what === 'fraud') {
  const r = await fraudScene(d);
  console.log('== the email\n' + r.email);
  console.log(`\n== the AI says: ${r.modelVerdict}\n${r.modelReply}`);
  if (r.proof) console.log(`(reply signed by enclave key ${r.proof.signingAddress}, signature valid ${r.proof.signatureValid})`);
  console.log(`\n== the agent's key tries ${r.attempt.method} anyway`);
  console.log(r.attempt.ok ? 'IT WORKED — this must never happen' : `rejected: ${r.attempt.error}`);
} else {
  console.error('usage: node scripts/agent.mts run | fraud');
  process.exit(1);
}
