// Server-side NEAR helpers shared by the seed script, the caretaker agent and
// (later) the website's API routes. Testnet only.

import { Account, FailoverRpcProvider, JsonRpcProvider, actions, type KeyPairString } from 'near-api-js';

export const RPC_URL = process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com/';
export const EXPLORER = 'https://testnet.nearblocks.io';

/** Used when the first RPC refuses us: FastNEAR rate-limits a whole IP for minutes after bursts (Nov 8). */
export const FALLBACK_RPC_URL = 'https://rpc.testnet.near.org';
export const provider = new FailoverRpcProvider([
  // Fail fast on the first one, so the fallback takes over instead of the page hanging.
  new JsonRpcProvider({ url: RPC_URL }, { retries: 1, wait: 200, backoff: 1 }),
  new JsonRpcProvider({ url: FALLBACK_RPC_URL }),
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Public RPCs reject bursts; these errors are worth retrying, others are not. */
function isTransient(message: string): boolean {
  return /rate limit|exceeded|429|nonce|timeout|ECONNRESET|fetch failed|socket|503|502|Server error/i.test(message);
}

async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 10): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = errorText(e);
      if (!isTransient(msg)) throw e;
      // Up to about 100 s in total: a rate limit on the public RPC can last over a minute (Nov 8).
      await sleep(Math.min(2000 * (i + 1), 15000));
    }
  }
  throw new Error(`${what}: gave up after retries: ${errorText(last)}`);
}

export function errorText(e: unknown): string {
  if (e instanceof Error) {
    const extra = (e as { cause?: unknown }).cause;
    return extra ? `${e.message} (${errorText(extra)})` : e.message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  // Reads give up sooner than transactions: a page waiting minutes looks frozen.
  return withRetry(`view ${method}`, () => provider.callFunction({ contractId, method, args }) as Promise<T>, 4);
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await withRetry('view account', () => provider.viewAccount({ accountId, finality: 'final' } as never));
    return true;
  } catch {
    return false;
  }
}

export function signerAccount(accountId: string, privateKey: string): Account {
  return new Account(accountId, provider, privateKey as KeyPairString);
}

export type CallResult = {
  ok: boolean;
  txHash?: string;
  /** The contract's or the network's refusal, in its own words. */
  error?: string;
  value?: unknown;
  logs: string[];
  /** Set when a relayer paid the fee (meta transaction). */
  relayedBy?: string;
};

/** Finds the first failure message anywhere in a transaction outcome. */
function failureOf(outcome: unknown): string | undefined {
  const o = outcome as {
    status?: { Failure?: unknown };
    transaction_outcome?: { outcome?: { status?: { Failure?: unknown } } };
    receipts_outcome?: { outcome?: { status?: { Failure?: unknown } } }[];
  };
  const all = [o.status, o.transaction_outcome?.outcome?.status, ...(o.receipts_outcome ?? []).map((r) => r.outcome?.status)];
  for (const s of all) {
    if (s && typeof s === 'object' && 'Failure' in s && s.Failure) return describeFailure(s.Failure);
  }
  return undefined;
}

function describeFailure(f: unknown): string {
  const text = JSON.stringify(f);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1];
  const exec = text.match(/"ExecutionError":"([^"]+)"/);
  if (exec) return exec[1];
  return text;
}

function logsOf(outcome: unknown): string[] {
  const o = outcome as { receipts_outcome?: { outcome?: { logs?: string[] } }[] };
  return (o.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []);
}

function decodeValue(outcome: unknown): unknown {
  const s = (outcome as { status?: { SuccessValue?: string } }).status;
  if (!s?.SuccessValue) return undefined;
  try {
    return JSON.parse(Buffer.from(s.SuccessValue, 'base64').toString());
  } catch {
    return undefined;
  }
}

/**
 * Calls a contract method and reports the outcome instead of throwing, so
 * callers can show a refusal (for example the agent being rejected).
 */
export async function call(
  account: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  opts: { gasTera?: number; depositYocto?: bigint } = {},
): Promise<CallResult> {
  const gas = BigInt(opts.gasTera ?? 30) * 10n ** 12n;
  const deposit = opts.depositYocto ?? 0n;
  return send(account, contractId, [actions.functionCall(methodName, args, gas, deposit)], `call ${methodName}`);
}

type Action = ReturnType<typeof actions.transfer>;

/** Signs and sends any actions; reports the outcome instead of throwing. */
export async function send(account: Account, receiverId: string, list: Action[], what = 'transaction'): Promise<CallResult> {
  try {
    const outcome = await withRetry(what, () =>
      account.signAndSendTransaction({ receiverId, actions: list, throwOnFailure: false }),
    );
    const txHash = (outcome as { transaction?: { hash?: string } }).transaction?.hash;
    const error = failureOf(outcome);
    return { ok: !error, txHash, error, value: decodeValue(outcome), logs: logsOf(outcome) };
  } catch (e) {
    return { ok: false, error: errorText(e), logs: [] };
  }
}

/**
 * Meta transaction (NEP-366): `user` signs the call as a delegate action and
 * `relayer` submits it and pays the fee, so the user needs no NEAR for gas.
 * The contract still sees `user` as the caller.
 */
export async function relayedCall(
  user: Account,
  relayer: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  opts: { gasTera?: number } = {},
): Promise<CallResult> {
  const gas = BigInt(opts.gasTera ?? 30) * 10n ** 12n;
  try {
    const { signedDelegate } = await withRetry(`sign ${methodName}`, () =>
      user.createSignedMetaTransaction({ receiverId: contractId, actions: [actions.functionCall(methodName, args, gas, 0n)] }),
    );
    const r = await send(relayer, user.accountId, [actions.signedDelegate(signedDelegate) as Action], `relay ${methodName}`);
    return { ...r, relayedBy: relayer.accountId };
  } catch (e) {
    return { ok: false, error: errorText(e), logs: [] };
  }
}

export const txLink = (hash?: string) => (hash ? `${EXPLORER}/txns/${hash}` : '');
export const accountLink = (id: string) => `${EXPLORER}/address/${id}`;

/** Sleep helper exported for scripts that must pace themselves. */
export const pause = sleep;
