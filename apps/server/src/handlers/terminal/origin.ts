/**
 * Origin validation for the /pty WebSocket upgrade (od-5j8.9).
 *
 * Browsers send an `Origin` header on every WebSocket handshake — including
 * same-origin ones — but, unlike `fetch`, do NOT enforce same-origin policy
 * on the upgrade itself and DO ride ambient cookies along with it. That's
 * the entire cross-site WebSocket hijacking primitive: a page on any other
 * origin can open `new WebSocket("wss://this-host/pty?...")` and the
 * browser will happily attach the victim's session cookie. Checking Origin
 * server-side is the fix — it's the one signal a malicious page cannot
 * spoof (the browser sets it, not page script).
 *
 * We no longer authenticate the upgrade from cookies at all (see ./ws.ts —
 * auth is a single-use ticket), so this check is defense-in-depth on top of
 * that, and it's cheap enough to run before touching Redis: reject a
 * forged/foreign origin before even looking at the ticket.
 */
import type { Context } from "hono";

/** Compare origins after stripping a trailing slash — `env.CORS_ORIGIN`
 *  entries are `z.url()`-validated absolute origins, but defend against a
 *  trailing-slash mismatch either side anyway. Case-insensitive per the
 *  scheme+host grammar (RFC 6454). */
function normalize(origin: string): string {
  return origin.replace(/\/+$/, "").toLowerCase();
}

/**
 * A missing Origin is rejected outright — every browser sends one on a
 * WebSocket handshake (same-origin or cross-origin), so the /pty upgrade
 * (browser-only; nothing else is authorized to mint a ticket) is always
 * "browser-shaped". A request with no Origin is either a non-browser tool
 * forging the upgrade or a browser stripping it for privacy reasons neither
 * of which should ever reach a shell.
 */
export function isTrustedOrigin(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  const normalizedOrigin = normalize(origin);
  return allowed.some((candidate) => normalize(candidate) === normalizedOrigin);
}

export function checkPtyOrigin(c: Context, allowed: readonly string[]): boolean {
  return isTrustedOrigin(c.req.header("origin"), allowed);
}
