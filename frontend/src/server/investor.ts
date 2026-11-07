// Investor and helper actions behind the mock login. Each on-chain step is
// signed with that person's own key (held by the demo site in place of their
// phone). Simulated pieces: the login code, strong identification and the bank
// check; they are labelled as such on screen.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { call, signerAccount, txLink, view, type CallResult } from './near.ts';
import { addToInbox, loadDeployment, type CastMember, type Deployment } from './store.ts';
import { readJsonFile, writeJsonFile } from './store.ts';

/** Off-chain profile details: never on-chain. */
type Profile = { bankLast4?: string; pendingBankLast4?: string; loginCode?: { code: string; at: number } };
const DEFAULT_BANK: Record<string, string> = { maria: '4821', tom: '1180', peter: '3307', erik: '5562' };

function profiles(): Record<string, Profile> {
  return readJsonFile<Record<string, Profile>>('profiles.json', {});
}
function saveProfile(key: string, p: Profile) {
  const all = profiles();
  all[key] = { ...all[key], ...p };
  writeJsonFile('profiles.json', all);
}
function profile(key: string): Profile {
  return { bankLast4: DEFAULT_BANK[key], ...profiles()[key] };
}

export type Reply = { ok: boolean; message: string; error?: string; explorer?: string; data?: unknown };
const reply = (r: CallResult, message: string): Reply => ({ ok: r.ok, message: r.ok ? message : 'That did not go through', error: r.error, explorer: txLink(r.txHash) });

export function member(d: Deployment, key: string): CastMember {
  const m = d.cast.find((c) => c.key === key);
  if (!m) throw new Error('unknown person');
  return m;
}

// ---------- Mock login ----------

export function people() {
  const d = loadDeployment();
  return d.cast.map((c) => ({ key: c.key, name: c.name, phoneEnd: c.phone.slice(-2), helperOf: c.helperOf }));
}

/** Sends a 6-digit code to the demo inbox, as a text would. */
export function sendLoginCode(key: string): Reply {
  const d = loadDeployment();
  const m = member(d, key);
  const code = String(randomInt(100000, 1000000));
  saveProfile(key, { loginCode: { code, at: Date.now() } });
  addToInbox({ id: randomBytes(6).toString('hex'), at: new Date().toISOString(), channel: 'text', to: m.key, toName: m.name, body: `Your login code is ${code}. Never share it with anyone, not even us.`, from: 'platform' });
  return { ok: true, message: `We sent a code to the phone ending ${m.phone.slice(-2)}.`, data: { code } };
}

export function checkLoginCode(key: string, code: string): boolean {
  const c = profile(key).loginCode;
  return Boolean(c && c.code === code.trim() && Date.now() - c.at < 10 * 60_000);
}

// ---------- What the investor sees ----------

type HolderRaw = {
  payout_method: 'near' | 'intents' | 'bank';
  intents_route: { chain: string; asset_id: string; address: string } | null;
  pending_change: { method: string; effective_at: number; extended: boolean } | null;
  helpers: string[];
  pending_helper_changes: unknown[];
  last_confirmed_at: number | null;
  contact_status: string;
  kyc_valid_until: number | null;
  screening: string;
  state: string;
};

export async function investorView(key: string) {
  const d = loadDeployment();
  const m = member(d, key);
  if (m.helperOf) return helperView(d, m);
  const [holder, status, payout, held] = await Promise.all([
    view<HolderRaw | null>(d.registry, 'get_holder', { holder_id: m.accountId }),
    view<string | null>(d.registry, 'get_status', { holder_id: m.accountId }),
    view<{ event: { state: string; snapshot: Record<string, number>; confirmations: Record<string, unknown>; lines: Record<string, { shares: number; amount: string; outcome: string }>; manifest_root: string | null } } | null>(d.registry, 'get_payout', { event_id: d.eventId }),
    view<string>(d.registry, 'get_held_funds', { company_id: d.companyId, holder_id: m.accountId }),
  ]);
  const [company, config] = await Promise.all([
    view<{ total_shares: number } | null>(d.registry, 'get_company', { company_id: d.companyId }),
    view<{ stale_after_ms: number }>(d.registry, 'get_config'),
  ]);
  const now = Date.now();
  const p = profile(key);
  const confirmation = payout?.event.confirmations[m.accountId] ?? 'unconfirmed';
  return {
    role: 'investor' as const,
    key,
    name: m.name,
    phoneEnd: m.phone.slice(-2),
    status,
    state: holder?.state,
    contactBounced: holder?.contact_status === 'bounced',
    kycExpired: holder?.kyc_valid_until != null && holder.kyc_valid_until <= now,
    detailsOld: !holder?.last_confirmed_at || now - holder.last_confirmed_at > config.stale_after_ms,
    payoutMethod: holder?.payout_method,
    bankLast4: p.bankLast4,
    route: holder?.intents_route,
    pendingChange: holder?.pending_change ? { ...holder.pending_change, bankLast4: p.pendingBankLast4 } : null,
    helpers: (holder?.helpers ?? []).map((id) => d.cast.find((c) => c.accountId === id)?.name ?? 'a helper'),
    company: { name: d.companyName, totalShares: company?.total_shares ?? 0 },
    event: payout
      ? {
          state: payout.event.state,
          sharesOnRecord: payout.event.snapshot[m.accountId],
          confirmation,
          line: payout.event.lines[m.accountId],
          manifestRoot: payout.event.manifest_root,
        }
      : null,
    held,
    now,
  };
}

async function helperView(d: Deployment, m: CastMember) {
  const of = member(d, m.helperOf!);
  const holder = await view<HolderRaw | null>(d.registry, 'get_holder', { holder_id: of.accountId });
  return {
    role: 'helper' as const,
    key: m.key,
    name: m.name,
    helperOf: { key: of.key, name: of.name },
    isHelperOnChain: Boolean(holder?.helpers.includes(m.accountId)),
    pendingChange: holder?.pending_change ? { ...holder.pending_change, bankLast4: profile(of.key).pendingBankLast4 } : null,
    currentBankLast4: profile(of.key).bankLast4,
    now: Date.now(),
  };
}

// ---------- Actions ----------

export async function act(key: string, op: string, body: Record<string, string>): Promise<Reply> {
  const d = loadDeployment();
  const m = member(d, key);
  const me = signerAccount(m.accountId, m.privateKey);
  switch (op) {
    case 'confirm-details':
      return reply(await call(me, d.registry, 'confirm_details', {}), 'Thank you. Your details are confirmed.');
    case 'confirm-holding': {
      const shares = Number(body.shares);
      if (!Number.isInteger(shares) || shares < 0 || shares > 10_000_000) return { ok: false, message: 'Please enter a whole number of shares.' };
      return reply(await call(me, d.registry, 'confirm_holding', { event_id: d.eventId, shares }), 'Thank you. We have your answer.');
    }
    case 'reidentify': {
      // Simulated strong identification; the simulated KYC provider records a new check with its own key.
      const kyc = signerAccount(d.kyc.accountId, d.kyc.privateKey);
      const r = await call(kyc, d.registry, 'record_kyc', { holder_id: m.accountId, valid_until: Date.now() + 365 * 24 * 3600_000, screening: 'clear' });
      return reply(r, 'Thank you. Your identity check is renewed for a year.');
    }
    case 'new-phone':
      return reply(await call(me, d.registry, 'record_contact_change', {}), 'Thank you. Your new phone number is saved.');
    case 'claim':
      return reply(await call(me, d.registry, 'claim', { company_id: d.companyId }, { gasTera: 100 }), 'Your money is on its way to you.');
    case 'bank-verify': {
      // Simulated bank login: the verifier records a fingerprint of the new account, never the number itself.
      const last4 = (body.last4 ?? '').replace(/\D/g, '').slice(-4);
      if (last4.length !== 4) return { ok: false, message: 'Please enter the last 4 digits of your new account.' };
      const fingerprint = createHash('sha256').update(`${m.accountId}|${last4}|${randomBytes(8).toString('hex')}`).digest('hex');
      const verifier = signerAccount(d.verifier.accountId, d.verifier.privateKey);
      const r = await call(verifier, d.registry, 'record_bank_verification', { holder_id: m.accountId, fingerprint });
      if (r.ok) saveProfile(key, { pendingBankLast4: last4 });
      return reply(r, 'Your bank confirmed the account is yours.');
    }
    case 'bank-request': {
      if (!checkLoginCode(key, body.code ?? '')) return { ok: false, message: 'That code is not right. Please check the text we sent.' };
      const r = await call(me, d.registry, 'request_payout_change', { holder_id: m.accountId, method: 'bank' });
      if (r.ok) {
        const h = await view<HolderRaw>(d.registry, 'get_holder', { holder_id: m.accountId });
        const when = new Date(h.pending_change!.effective_at).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
        const last4 = profile(key).pendingBankLast4;
        for (const helperId of h.helpers) {
          const helper = d.cast.find((c) => c.accountId === helperId);
          if (!helper) continue;
          addToInbox({
            id: randomBytes(6).toString('hex'), at: new Date().toISOString(), channel: 'helper', to: helper.key, toName: helper.name, from: 'platform',
            subject: `${m.name} asked to change the bank account for payouts`,
            body: `${m.name} asked to change where payouts go, to a bank account ending ${last4}. It takes effect ${when}. If that sounds right, there's nothing to do. If not, open the app and tap "Cancel this change".`,
          });
        }
      }
      return { ...reply(r, 'Your change is saved.'), data: { helpers: h_names(d, m) } };
    }
    case 'cancel-change':
      return reply(await call(me, d.registry, 'cancel_payout_change', { holder_id: m.accountId }), 'The change is cancelled. Nothing was changed.');
    case 'helper-cancel': {
      if (!m.helperOf) return { ok: false, message: 'Only a helper can do this.' };
      const of = member(d, m.helperOf);
      const r = await call(me, d.registry, 'cancel_payout_change', { holder_id: of.accountId });
      if (r.ok) {
        saveProfile(of.key, { pendingBankLast4: undefined });
        addToInbox({ id: randomBytes(6).toString('hex'), at: new Date().toISOString(), channel: 'email', to: of.key, toName: of.name, from: 'platform', subject: 'Your bank change was cancelled', body: `Hello ${of.name}, ${m.name} cancelled the change to your bank account, so your payouts still go to the account ending ${profile(of.key).bankLast4}. If you did want this change, please call us and we'll help.` });
      }
      return reply(r, `Cancelled. ${of.name}'s payouts still go to the usual account.`);
    }
    case 'check-payment': {
      const line = (await view<{ event: { lines: Record<string, { shares: number; amount: string }> } }>(d.registry, 'get_payout', { event_id: d.eventId })).event.lines[m.accountId];
      if (!line) return { ok: false, message: 'There is no payment to check yet.' };
      const proof = await view<unknown[]>(d.registry, 'get_manifest_proof', { event_id: d.eventId, holder_id: m.accountId });
      const ok = await view<boolean>(d.registry, 'verify_manifest_line', { event_id: d.eventId, holder_id: m.accountId, shares: line.shares, amount: line.amount, proof });
      return { ok, message: ok ? 'Checked' : 'This payment does not match', data: { shares: line.shares, amount: line.amount, proofSteps: proof.length } };
    }
    default:
      return { ok: false, message: 'Unknown action' };
  }
}

function h_names(d: Deployment, m: CastMember) {
  return d.cast.filter((c) => c.helperOf === m.key).map((c) => c.name);
}
