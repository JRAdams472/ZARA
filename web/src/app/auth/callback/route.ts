import { NextRequest, NextResponse } from 'next/server';
import { finishLogin } from '@/lib/auth';
import { requestOrigin } from '@/lib/origin';

/** IdP redirect target: verify state, exchange code, seal the session. */
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code) {
    return NextResponse.redirect(new URL('/auth/login', origin));
  }
  try {
    const next = await finishLogin(code, state);
    // Re-validate the cookie-carried target: the state cookie isn't
    // integrity-protected, so a tampered `//host` must not redirect off-site.
    const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    return NextResponse.redirect(new URL(safe, origin));
  } catch (e) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(`${e}`)}`, origin));
  }
}
