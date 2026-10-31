import 'server-only';

import type { NextRequest } from 'next/server';

/** Public origin for redirects — `req.nextUrl.origin` reports the
 *  standalone server's bind address (0.0.0.0) inside containers, not the
 *  host the browser actually used. Prefer the forwarded/Host headers the
 *  terminator sent; fall back to nextUrl only when headers are absent. */
export function requestOrigin(req: NextRequest): string {
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}
