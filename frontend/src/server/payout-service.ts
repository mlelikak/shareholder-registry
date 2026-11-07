// Payout service for Intents routes. It holds only the payout service key,
// which the contract lets do two things: reveal a holder's registered route
// for a line waiting for one, and report how the delivery went.
//
// Flow per line: release_for_route → 1Click quote → deliver → report result.
// SUCCESS repays the service in test euros; anything else is held for the
// holder, never paid.
//
// In this demo the 1Click quote is real (a dry run on mainnet: read-only, no
// money moves) and the delivery is SIMULATED, labelled as such everywhere.
// A real, tiny mainnet transfer is a separate step that Mike confirms.

import { call, signerAccount, txLink, view } from './near.ts';
import { loadDeployment, readJsonFile, writeJsonFile, type Deployment } from './store.ts';

const ONECLICK = process.env.ONECLICK_URL ?? 'https://1click.chaindefuser.com';
/** USDC on NEAR is what the service would send from; 1Click asset IDs. */
const ORIGIN_ASSET = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const DESTINATION_ASSETS: Record<string, string> = {
  'base:usdc': 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
};
/** The demo quotes a tiny real-world amount (0.10 USDC), not the test-euro share. */
const DEMO_QUOTE_UNITS = '100000';
/** A dry-run quote needs a refund account that exists on mainnet; nothing is sent. */
const REFUND_TO = process.env.ONECLICK_REFUND_TO ?? 'intents.near';

type Route = { chain: string; asset_id: string; address: string };

export type Quote = {
  ok: boolean;
  amountIn?: string;
  amountOut?: string;
  minAmountOut?: string;
  timeEstimate?: number;
  error?: string;
  at: string;
};

export type Delivery = {
  holderKey: string;
  holderName: string;
  route: Route;
  /** The holder's calculated share, in test-euro units on testnet. */
  amount: string;
  quote: Quote;
  /** Always true until the real mainnet transfer is added. */
  simulated: boolean;
  result: 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'INCOMPLETE_DEPOSIT';
  releaseTx?: string;
  reportTx?: string;
  at: string;
};

export const loadDeliveries = () => readJsonFile<Delivery[]>('deliveries.json', []);

async function dryQuote(route: Route): Promise<Quote> {
  const at = new Date().toISOString();
  const destinationAsset = DESTINATION_ASSETS[`${route.chain}:${route.asset_id}`];
  if (!destinationAsset) return { ok: false, error: `no 1Click asset for ${route.asset_id} on ${route.chain}`, at };
  try {
    const r = await fetch(`${ONECLICK}/v0/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify({
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: ORIGIN_ASSET,
        depositType: 'ORIGIN_CHAIN',
        destinationAsset,
        amount: DEMO_QUOTE_UNITS,
        refundTo: REFUND_TO,
        refundType: 'ORIGIN_CHAIN',
        recipient: route.address,
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    });
    const j = (await r.json()) as { quote?: Record<string, unknown>; message?: string };
    if (!r.ok || !j.quote) return { ok: false, error: j.message ?? `HTTP ${r.status}`, at };
    const q = j.quote as { amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number };
    return { ok: true, amountIn: q.amountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, timeEstimate: q.timeEstimate, at };
  } catch (e) {
    return { ok: false, error: (e as Error).message, at };
  }
}

/** Delivers every line that is waiting for an Intents route. */
export async function deliverIntents(d: Deployment = loadDeployment()): Promise<{ delivered: Delivery[]; errors: string[] }> {
  const svc = signerAccount(d.payoutService.accountId, d.payoutService.privateKey);
  const payout = await view<{ event: { lines: Record<string, { amount: string; outcome: string }> } } | null>(d.registry, 'get_payout', { event_id: d.eventId });
  const waiting = Object.entries(payout?.event.lines ?? {}).filter(([, l]) => l.outcome === 'awaiting_route');
  const delivered: Delivery[] = [];
  const errors: string[] = [];

  for (const [holderId, line] of waiting) {
    const who = d.cast.find((c) => c.accountId === holderId);
    const released = await call(svc, d.registry, 'release_for_route', { event_id: d.eventId, holder_id: holderId });
    if (!released.ok) {
      errors.push(`release for ${who?.name ?? holderId}: ${released.error}`);
      continue;
    }
    const route = released.value as Route;
    const quote = await dryQuote(route);
    // SIMULATED delivery: in production the service sends to the 1Click
    // deposit address here and polls /v0/status until it settles.
    const result: Delivery['result'] = 'SUCCESS';
    const reported = await call(svc, d.registry, 'report_route_result', { event_id: d.eventId, holder_id: holderId, result }, { gasTera: 100 });
    if (!reported.ok) errors.push(`report for ${who?.name ?? holderId}: ${reported.error}`);
    const delivery: Delivery = {
      holderKey: who?.key ?? holderId,
      holderName: who?.name ?? holderId.slice(0, 8),
      route,
      amount: line.amount,
      quote,
      simulated: true,
      result,
      releaseTx: txLink(released.txHash),
      reportTx: txLink(reported.txHash),
      at: new Date().toISOString(),
    };
    delivered.push(delivery);
    writeJsonFile('deliveries.json', [...loadDeliveries(), delivery]);
  }
  return { delivered, errors };
}
