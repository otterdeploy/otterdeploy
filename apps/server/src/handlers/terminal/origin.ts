/**
 * Origin validation for the /pty WebSocket upgrade (od-5j8.9).
 *
 * Browsers send an `Origin` header on every WebSocket handshake. Including
 * same-origin ones, but, unlike `fetch`, do NOT enforce same-origin policy
 * on the upgrade itself and DO ride ambient cookies along with it. That's
 * the entire cross-site WebSocket hijacking primitive: a page on any other
 * origin can open `new WebSocket("wss://this-host/pty?...")` and the
 * browser will happily attach the victim's session cookie. Checking Origin
 * server-side is the fix. It's the one signal a malicious page cannot
 * spoof (the browser sets it, not page script).
 *
 * We no longer authenticate the upgrade from cookies at all (see ./ws.ts,
 * auth is a single-use ticket), so this check is defense-in-depth on top of
 * that, and it's cheap enough to run before touching Redis: reject a
 * forged/foreign origin before even looking at the ticket.
 */

/** Compare origins after stripping a trailing slash: `env.CORS_ORIGIN`
 *  entries are `z.url()`-validated absolute origins, but defend against a
 *  trailing-slash mismatch either side anyway. Case-insensitive per the
 *  scheme+host grammar (RFC 6454). */
function normalize(origin: string): string {
  return origin.replace(/\/+$/, "").toLowerCase();
}

/**
 * A missing Origin is rejected outright. Every browser sends one on a
 * WebSocket handshake (same-origin or cross-origin), so the /pty upgrade
 * (browser-only; nothing else is authorized to mint a ticket) is always
 * "browser-shaped". A request with no Origin is either a non-browser tool
 * forging the upgrade or a browser stripping it for privacy reasons neither
 * of which should ever reach a shell.
 */
export function isTrustedOrigin(
  origin: string | null | undefined,
  allowed: readonly string[],
  /** The upgrade's own `Host`. When the Origin's host equals it, the request is
   *  same-origin and is trusted without being enumerated. See below. */
  host?: string | null,
): boolean {
  if (!origin) return false;
  const normalizedOrigin = normalize(origin);
  if (allowed.some((candidate) => normalize(candidate) === normalizedOrigin)) return true;
  return isSameOrigin(origin, host);
}

/**
 * Same-origin requests are trusted without appearing in `CORS_ORIGIN`.
 *
 * An install is reachable at several legitimate origins. Public IP, LAN IP,
 * the control-plane domain, a tunnel, and better-auth already accepts all of
 * them by echoing a same-origin `Origin` (see packages/auth trustedOrigins).
 * This check did NOT, so adding a control-plane domain left the whole app
 * working while the terminal alone returned 403 and the UI rendered it as an
 * endless "connection lost, reconnecting".
 *
 * Still CSRF-safe, and for the same reason better-auth's is: a cross-site
 * attacker's page has its own Origin host, which cannot equal our Host, so it
 * is never same-origin. And Origin is browser-set. Page script cannot forge
 * it. Authorization itself remains the single-use ticket; this is defence in
 * depth over that, not the gate.
 */
function isSameOrigin(origin: string, host: string | null | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    // A malformed Origin is not same-origin, fall through to rejection.
    return false;
  }
}
