import 'server-only';

import type { NextRequest } from 'next/server';

import { cfg } from './config';

/** Public origin for redirects — `req.nextUrl.origin` reports the
 *  standalone server's bind address (0.0.0.0) inside containers, not the
 *  host the browser actually used. In prod `PUBLIC_ORIGIN` pins the
 *  answer so a spoofed Host/X-Forwarded-* can't steer post-login
 *  redirects; in dev the forwarded/Host headers the terminator sent win,
 *  falling back to nextUrl only when headers are absent. */
export function requestOrigin(req: NextRequest): string {
  if (cfg.publicOrigin) return cfg.publicOrigin;
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}
