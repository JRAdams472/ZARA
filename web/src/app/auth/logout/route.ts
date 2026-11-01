import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';
import { requestOrigin } from '@/lib/origin';

/** Drop the session cookie and bounce back through the login flow. */
export async function GET(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL('/login', requestOrigin(req)));
}
