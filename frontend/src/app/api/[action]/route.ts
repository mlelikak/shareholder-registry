// Demo API. Keys stay on the server; responses never include them.
//   GET  /api/state | /api/inbox | /api/agent-log
//   POST /api/agent-run | /api/agent-fraud | /api/apply | /api/payout | /api/bounce | /api/attack

import { NextResponse } from 'next/server';
import { readState } from '@/server/state.ts';
import { loadAgentLog, loadDeployment, loadInbox } from '@/server/store.ts';
import { runAgent } from '@/server/agent/run.ts';
import { fraudScene } from '@/server/agent/fraud.ts';
import { applyProposal, attackerTry, runPayout, simulateBounce } from '@/server/actions.ts';
import { errorText } from '@/server/near.ts';
import { resetRunning, resetStatus, startReset } from '@/server/reset.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ action: string }> };

function fail(e: unknown, status = 500) {
  return NextResponse.json({ ok: false, message: 'Something went wrong', error: errorText(e) }, { status });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  try {
    if (action === 'state') return NextResponse.json(await readState());
    if (action === 'inbox') return NextResponse.json(loadInbox().slice().reverse());
    if (action === 'agent-log') return NextResponse.json(loadAgentLog().slice().reverse());
    if (action === 'reset-status') return NextResponse.json(resetStatus());
    return fail('unknown action', 404);
  } catch (e) {
    return fail(e);
  }
}

/** One action at a time, so two clicks can't race each other on-chain. */
let busy = false;

export async function POST(req: Request, ctx: Ctx) {
  const { action } = await ctx.params;
  if (busy) return NextResponse.json({ ok: false, message: 'Another action is still running. Try again in a moment.' }, { status: 429 });
  if (resetRunning()) return NextResponse.json({ ok: false, message: 'The demo is being reset. Try again when it has finished.' }, { status: 409 });
  if (action === 'reset') return NextResponse.json(startReset());
  busy = true;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    switch (action) {
      case 'agent-run': {
        const r = await runAgent(loadDeployment());
        return NextResponse.json({ ok: true, message: `Agent finished: ${r.readiness.ready} of ${r.readiness.total} ready, ${r.messages} messages sent.` });
      }
      case 'agent-fraud': {
        const r = await fraudScene(loadDeployment());
        return NextResponse.json({ ok: !r.attempt.ok, message: `The AI said "${r.modelVerdict}". The forced attempt was ${r.attempt.ok ? 'ACCEPTED' : 'rejected by the network'}.`, result: r });
      }
      case 'apply':
        return NextResponse.json(await applyProposal(body.proposalId));
      case 'payout':
        return NextResponse.json(await runPayout());
      case 'bounce':
        return NextResponse.json(await simulateBounce(body.holder));
      case 'attack':
        return NextResponse.json(await attackerTry(body.who === 'insider' ? 'insider' : 'outsider'));
      default:
        return fail('unknown action', 404);
    }
  } catch (e) {
    return fail(e);
  } finally {
    busy = false;
  }
}
