// Deploys a fresh demo copy on NEAR testnet and seeds the exit-day cast.
// Test tokens only, not real money.
//
// Usage (from frontend/): node scripts/seed.mts <suffix> <funded-testnet-account>
// The funder's key must be in ~/.near-credentials/testnet/<account>.json.
// Uses about 8 test NEAR. Writes keys and names to .demo/ (git-ignored).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KeyPair, actions, keyToImplicitAddress } from 'near-api-js';
import { accountExists, call, pause, provider, send, signerAccount, txLink, accountLink, view, type CallResult } from '../src/server/near.ts';
import { resetDemoState, saveDeployment, type CastMember, type Deployment, type KeyedAccount } from '../src/server/store.ts';

const [suffix, funderId] = process.argv.slice(2);
if (!suffix || !funderId) {
  console.error('usage: node scripts/seed.mts <suffix> <funded-testnet-account>');
  process.exit(1);
}

const NEAR = (n: number) => BigInt(Math.round(n * 1_000_000)) * 10n ** 18n;
const ROOT = join(import.meta.dirname, '..', '..');
const REGISTRY_WASM = join(ROOT, 'contract/target/near/shareholder_registry.wasm');
const TOKEN_WASM = join(ROOT, 'token/target/near/test_euro.wasm');

/** Demo clock from DESIGN.md section 4. */
const CONFIG = {
  cooling_off_ms: 2 * 60_000,
  extended_cooling_off_ms: 5 * 60_000,
  recent_contact_change_ms: 10 * 60_000,
  stale_after_ms: 10 * 60_000,
  verification_valid_for_ms: 10 * 60_000,
};
/** Shares in Acme: two VC funds and five individual investors. */
const SHARES_OF: Record<string, number> = { larkspur: 12_000, quarry: 8_000 };
const SHARES = 1000; // each individual investor
const sharesOf = (key: string) => SHARES_OF[key] ?? SHARES;
const TOTAL_SHARES = 5 * SHARES + 12_000 + 8_000; // 25,000
// €1 per share in test euros (6 decimals), plus 3 units to show the rounding remainder.
const TOTAL = `${TOTAL_SHARES}000003`;
const COMPANY = { id: 'acme', name: 'Acme' };
const EVENT_ID = 'acme-exit';

/** The demo methods each restricted role may call (DESIGN.md section 3). */
const AGENT_METHODS = ['flag_holder', 'pause_holder', 'freeze_holder', 'log_agent_action'];

const PEOPLE: Omit<CastMember, 'accountId' | 'privateKey'>[] = [
  { key: 'maria', name: 'Maria Keller', email: 'maria.keller@example.com', phone: '+00 555 0101' },
  { key: 'tom', name: 'Tom Hartley', email: 'tom.hartley@example.com', phone: '+00 555 0102' },
  { key: 'peter', name: 'Peter Novak', email: 'peter.novak@example.com', phone: '+00 555 0103' },
  { key: 'lena', name: 'Lena Ortiz', email: 'lena.ortiz@example.com', phone: '+00 555 0104' },
  { key: 'erik', name: 'Erik Lund', email: 'erik.lund@example.com', phone: '+00 555 0105' },
  // Fictional VC funds: verified like everyone else, and simply ready on exit day.
  { key: 'larkspur', name: 'Larkspur Ventures', email: 'operations@larkspur.example', phone: '+00 555 0201' },
  { key: 'quarry', name: 'Quarry Hill Capital', email: 'finance@quarryhill.example', phone: '+00 555 0202' },
  { key: 'anna', name: 'Anna Keller', email: 'anna.keller@example.com', phone: '+00 555 0106', helperOf: 'maria' },
  { key: 'jonas', name: 'Jonas Lund', email: 'jonas.lund@example.com', phone: '+00 555 0107', helperOf: 'erik' },
];

/** Keys are saved to disk before they are used, so a stopped run can resume. */
const KEYS_FILE = join(ROOT, 'frontend', '.demo', `keys-${suffix}.json`);
const savedKeys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
function keyFor(name: string): KeyPair {
  if (!savedKeys[name]) {
    savedKeys[name] = KeyPair.fromRandom('ed25519').toString();
    mkdirSync(join(ROOT, 'frontend', '.demo'), { recursive: true });
    writeFileSync(KEYS_FILE, JSON.stringify(savedKeys, null, 2));
  }
  return KeyPair.fromString(savedKeys[name] as never);
}

/** On a resumed run, these refusals mean the step already happened. */
const ALREADY = /already|exists|pending change|is open/i;

let failures = 0;
function report(label: string, r: CallResult, mustWork = true) {
  if (r.ok) {
    console.log(`ok    ${label}`);
  } else if (r.error && ALREADY.test(r.error)) {
    console.log(`done  ${label} (earlier run)`);
  } else {
    console.log(`${mustWork ? 'FAIL ' : 'note '} ${label}: ${r.error}`);
    if (mustWork) failures++;
  }
  return r;
}
function stopIfFailed() {
  if (failures) {
    console.error(`\nSeed stopped after ${failures} failure(s).`);
    process.exit(1);
  }
}

const funderKey = JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', `${funderId}.json`), 'utf8')).private_key;
const funder = signerAccount(funderId, funderKey);

async function createNamed(prefix: string, amount: number, fullKey = true): Promise<KeyedAccount> {
  const accountId = `${prefix}-${suffix}.${funderId}`;
  const kp = keyFor(prefix);
  if (await accountExists(accountId)) {
    console.log(`done  create ${accountId} (earlier run)`);
    return { accountId, privateKey: kp.toString() };
  }
  const list = [actions.createAccount(), actions.transfer(NEAR(amount))];
  if (fullKey) list.push(actions.addFullAccessKey(kp.getPublicKey()));
  report(`create ${accountId}`, await send(funder, accountId, list, `create ${prefix}`));
  stopIfFailed();
  return { accountId, privateKey: kp.toString() };
}

async function main() {
  console.log(`== accounts (funder ${funderId})`);
  const registry = await createNamed('reg', 4.2);
  const token = await createNamed('teur', 1.65);
  const admin = await createNamed('admin', 0.4);
  const kyc = await createNamed('kyc', 0.3);
  const verifier = await createNamed('verifier', 0.15);
  const reviewer = await createNamed('reviewer', 0.15);
  const payoutService = await createNamed('svc', 0.25);
  const attacker = await createNamed('attacker', 0.1);
  // Pays investors' fees through meta transactions, so investors need no NEAR.
  const relayer = await createNamed('relay', 1);
  // A second company on the same registry, with its own admin.
  const bloomAdmin = await createNamed('bloom', 0.3);

  // The agent account gets ONLY a function-call key limited to its four methods
  // on the registry. No full-access key exists, so nothing else can be signed.
  const agentId = `agent-${suffix}.${funderId}`;
  const agentKey = keyFor('agent');
  if (!(await accountExists(agentId))) report(
    `create ${agentId} with a restricted key only`,
    await send(funder, agentId, [
      actions.createAccount(),
      actions.transfer(NEAR(0.4)),
      actions.addFunctionCallAccessKey(agentKey.getPublicKey(), registry.accountId, AGENT_METHODS, NEAR(0.35)),
    ]),
  );
  stopIfFailed();

  // Investors and the helper get random implicit accounts: a transfer creates them.
  const cast: CastMember[] = [];
  for (const p of PEOPLE) {
    const kp = keyFor(p.key);
    const accountId = keyToImplicitAddress(kp.getPublicKey());
    if (!(await accountExists(accountId))) report(`create ${p.name}'s random account`, await send(funder, accountId, [actions.transfer(NEAR(0.1))]));
    cast.push({ ...p, accountId, privateKey: kp.toString() });
  }
  // The estate's account (estate flow): a random account like everyone else's.
  const estateKey = keyFor('estate');
  const estate: KeyedAccount = { accountId: keyToImplicitAddress(estateKey.getPublicKey()), privateKey: estateKey.toString() };
  if (!(await accountExists(estate.accountId))) report("create the estate's random account", await send(funder, estate.accountId, [actions.transfer(NEAR(0.1))]));
  stopIfFailed();
  const who = (key: string) => cast.find((c) => c.key === key)!;
  const as = (k: KeyedAccount) => signerAccount(k.accountId, k.privateKey);

  console.log('== deploy');
  const deployed = async (id: string) => {
    const state = (await provider.viewAccount({ accountId: id, finality: 'final' } as never)) as { code_hash?: string };
    return Boolean(state.code_hash && state.code_hash !== '11111111111111111111111111111111');
  };
  if (await deployed(token.accountId)) console.log('done  token deployed (earlier run)');
  else report(
    'token deployed',
    await send(as(token), token.accountId, [
      actions.deployContract(new Uint8Array(readFileSync(TOKEN_WASM))),
      actions.functionCall('new', { owner_id: admin.accountId, total_supply: TOTAL }, 100n * 10n ** 12n, 0n),
    ]),
  );
  if (await deployed(registry.accountId)) console.log('done  registry deployed (earlier run)');
  else report(
    'registry deployed',
    await send(as(registry), registry.accountId, [
      actions.deployContract(new Uint8Array(readFileSync(REGISTRY_WASM))),
      actions.functionCall(
        'new',
        {
          config: CONFIG,
          roles: {
            verifier: verifier.accountId,
            kyc_provider: kyc.accountId,
            agent: agentId,
            estate_reviewer: reviewer.accountId,
            payout_service: payoutService.accountId,
          },
        },
        100n * 10n ** 12n,
        0n,
      ),
    ]),
  );
  stopIfFailed();

  console.log('== token registration');
  for (const id of [registry.accountId, payoutService.accountId, estate.accountId, ...cast.filter((c) => !c.helperOf).map((c) => c.accountId)]) {
    report(`token account for ${id.slice(0, 16)}`, await call(funder, token.accountId, 'storage_deposit', { account_id: id }, { depositYocto: NEAR(0.0025) }));
    await pause(250);
  }
  stopIfFailed();

  console.log('== holders');
  const now = Date.now();
  const year = 365 * 24 * 3600_000;
  for (const c of cast.filter((c) => !c.helperOf)) {
    report(`${c.name} registers`, await call(as(c), registry.accountId, 'register_holder', {}));
    report(`${c.name} confirms details`, await call(as(c), registry.accountId, 'confirm_details', {}));
    // Peter's KYC ran out yesterday; everyone else is valid for a year.
    const validUntil = c.key === 'peter' ? now - 24 * 3600_000 : now + year;
    report(`${c.name} KYC recorded`, await call(as(kyc), registry.accountId, 'record_kyc', { holder_id: c.accountId, valid_until: validUntil, screening: 'clear' }));
  }
  stopIfFailed();

  console.log('== payout choices');
  const maria = who('maria');
  const lena = who('lena');
  report('bank verified for Maria (simulated)', await call(as(verifier), registry.accountId, 'record_bank_verification', {
    holder_id: maria.accountId,
    fingerprint: 'a1b2c3d4'.repeat(8),
  }));
  report('Maria chooses her bank', await call(as(maria), registry.accountId, 'request_payout_change', { holder_id: maria.accountId, method: 'bank' }));
  report('Lena chooses USDC on Base', await call(as(lena), registry.accountId, 'request_payout_change', {
    holder_id: lena.accountId,
    method: 'intents',
    // A sample address unless LENA_BASE_ADDRESS is set (the all-zero address is refused by 1Click).
    new_route: { chain: 'base', asset_id: 'usdc', address: process.env.LENA_BASE_ADDRESS ?? '0x1111111111111111111111111111111111111111' },
  }));
  report('Maria adds Anna as her helper', await call(as(maria), registry.accountId, 'add_helper', { helper_id: who('anna').accountId }));
  report('Erik adds his son Jonas as his helper', await call(as(who('erik')), registry.accountId, 'add_helper', { helper_id: who('jonas').accountId }));
  // Maria's phone number changed recently: any change she asks for now waits longer.
  report("Maria's phone change recorded", await call(as(maria), registry.accountId, 'record_contact_change', {}));
  stopIfFailed();

  console.log('== company and exit');
  const adm = as(admin);
  report('Acme created', await call(adm, registry.accountId, 'create_company', {
    company_id: COMPANY.id,
    name: COMPANY.name,
    payout_token: token.accountId,
    total_shares: TOTAL_SHARES,
  }));
  for (const c of cast.filter((c) => !c.helperOf)) {
    report(`${c.name} holds ${sharesOf(c.key)}`, await call(adm, registry.accountId, 'set_holding', { company_id: COMPANY.id, holder_id: c.accountId, shares: sharesOf(c.key) }));
  }
  // Bloom Foods uses the same verified details: no new sign-up for Maria or Peter.
  const bloom = as(bloomAdmin);
  report('Bloom Foods created', await call(bloom, registry.accountId, 'create_company', {
    company_id: 'bloom',
    name: 'Bloom Foods',
    payout_token: token.accountId,
    total_shares: 1000,
  }));
  report('Maria holds 600 Bloom Foods shares', await call(bloom, registry.accountId, 'set_holding', { company_id: 'bloom', holder_id: maria.accountId, shares: 600 }));
  report('Peter holds 400 Bloom Foods shares', await call(bloom, registry.accountId, 'set_holding', { company_id: 'bloom', holder_id: who('peter').accountId, shares: 400 }));
  report('exit payout opened', await call(adm, registry.accountId, 'open_payout', { event_id: EVENT_ID, company_id: COMPANY.id, total: TOTAL }));
  report("Tom's email bounced", await call(adm, registry.accountId, 'mark_contact_bounced', { company_id: COMPANY.id, holder_id: who('tom').accountId }));
  report('exit funded', await call(adm, token.accountId, 'ft_transfer_call', { receiver_id: registry.accountId, amount: TOTAL, msg: EVENT_ID }, { depositYocto: 1n, gasTera: 100 }));
  stopIfFailed();

  console.log('== holders answer "Is your share count right?"');
  report('Maria: 1,000 ✓', await call(as(maria), registry.accountId, 'confirm_holding', { event_id: EVENT_ID, shares: 1000 }));
  report('Larkspur Ventures: 12,000 ✓', await call(as(who('larkspur')), registry.accountId, 'confirm_holding', { event_id: EVENT_ID, shares: 12_000 }));
  report('Quarry Hill Capital: 8,000 ✓', await call(as(who('quarry')), registry.accountId, 'confirm_holding', { event_id: EVENT_ID, shares: 8_000 }));
  report('Erik: 1,000 ✓', await call(as(who('erik')), registry.accountId, 'confirm_holding', { event_id: EVENT_ID, shares: 1000 }));
  report('Peter says 800', await call(as(who('peter')), registry.accountId, 'confirm_holding', { event_id: EVENT_ID, shares: 800 }));
  report('Lena says 1,200', await call(as(lena), registry.accountId, 'confirm_holding', { event_id: EVENT_ID, shares: 1200 }));
  console.log('      Tom has not answered');
  stopIfFailed();

  const deployment: Deployment = {
    createdAt: new Date().toISOString(),
    funder: funderId,
    registry: registry.accountId,
    token: token.accountId,
    companyId: COMPANY.id,
    companyName: COMPANY.name,
    eventId: EVENT_ID,
    total: TOTAL,
    admin,
    kyc,
    verifier,
    reviewer,
    payoutService,
    agent: { accountId: agentId, privateKey: agentKey.toString(), allowedMethods: AGENT_METHODS },
    attacker,
    relayer,
    estate,
    otherCompanies: [{ id: 'bloom', name: 'Bloom Foods', admin: bloomAdmin }],
    cast,
  };
  saveDeployment(deployment);
  resetDemoState();

  const funded = await view<string>(token.accountId, 'ft_balance_of', { account_id: registry.accountId });
  console.log(`\nSeeded. Registry holds ${funded} units for the exit.`);
  console.log(`registry: ${accountLink(registry.accountId)}`);
  console.log(`agent (restricted key only): ${accountLink(agentId)}`);
  void txLink;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
