// Investor and helper API behind the mock login.
//   GET  /api/me/people | /api/me/view
//   POST /api/me/send-code | /api/me/login | /api/me/logout | /api/me/<action>

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { act, checkLoginCode, investorView, people, sendLoginCode } from '@/server/investor.ts';
import { errorText } from '@/server/near.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const COOKIE = 'demo_user';
type Ctx = { params: Promise<{ op: string }> };

async function who(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { op } = await ctx.params;
  try {
    if (op === 'people') return NextResponse.json(people());
    if (op === 'view') {
      const key = await who();
      if (!key) return NextResponse.json({ loggedIn: false });
      return NextResponse.json({ loggedIn: true, ...(await investorView(key)) });
    }
    return NextResponse.json({ ok: false, message: 'unknown' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: 'Something went wrong', error: errorText(e) }, { status: 500 });
  }
}

let busy = false;

export async function POST(req: Request, ctx: Ctx) {
  const { op } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  try {
    if (op === 'send-code') return NextResponse.json(sendLoginCode(body.key));
    if (op === 'login') {
      if (!checkLoginCode(body.key, body.code ?? '')) return NextResponse.json({ ok: false, message: 'That code is not right. Please check the text we sent.' });
      (await cookies()).set(COOKIE, body.key, { httpOnly: true, sameSite: 'lax', path: '/' });
      return NextResponse.json({ ok: true, message: 'Logged in' });
    }
    if (op === 'logout') {
      (await cookies()).delete(COOKIE);
      return NextResponse.json({ ok: true, message: 'Logged out' });
    }
    const key = await who();
    if (!key) return NextResponse.json({ ok: false, message: 'Please log in first.' }, { status: 401 });
    if (busy) return NextResponse.json({ ok: false, message: 'Still working on your last step. Please try again in a moment.' }, { status: 429 });
    busy = true;
    try {
      return NextResponse.json(await act(key, op, body));
    } finally {
      busy = false;
    }
  } catch (e) {
    return NextResponse.json({ ok: false, message: 'Something went wrong', error: errorText(e) }, { status: 500 });
  }
}
