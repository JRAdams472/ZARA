import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';

/** Drop the session cookie and bounce back through the login flow. */
export async function GET(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
}
