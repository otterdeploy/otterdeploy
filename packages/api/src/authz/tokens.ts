/**
 * Deployment-protection token signing — the cross-domain auth handoff.
 *
 * Two signed artifacts, both HMAC-SHA256 over BETTER_AUTH_SECRET (same
 * no-extra-secret-to-provision contract as git/state.ts and lib/crypto.ts):
 *
 *  1. Handoff token — minted by /authorize on the central auth authority
 *     after a successful master-session + org-membership check. Rides in
 *     the redirect URL to the deployment domain's callback. Very short TTL
 *     + a nonce so URL exposure (history/referer/logs) and replay are
 *     bounded. Domain-bound so it can't be replayed to another deployment.
 *
 *  2. Session cookie (`__otter_auth`) — set host-only on the deployment
 *     domain by the callback. Self-attesting, so the forward_auth endpoint
 *     validates it with a pure HMAC check (no DB hit). Longer TTL bounds
 *     revocation lag: removing a member locks them out within ≤TTL, when
 *     the next request re-runs the handoff against live membership.
 *
 * Token shape (both): base64url(JSON(payload)).hmac  — payload carries a
 * `p` (purpose) tag so a handoff token can never be used as a session
 * cookie or vice-versa. Timing-safe compare on verify; invalid/expired
 * verifies to null (never throws), matching git/state.ts.
 *
 * See docs/designs/deployment-protection.md §8.
 */

import { env } from "@otterdeploy/env/server";
import { timingSafeEqual } from "@otterdeploy/shared/crypto";

/** Handoff token lifetime — long enough for one redirect, short enough
 *  that a leaked URL is near-useless. */
const HANDOFF_TTL_SECONDS = 60;
/** Per-domain session cookie lifetime — also the upper bound on revocation
 *  lag (next request after expiry re-checks live org membership). */
const SESSION_TTL_SECONDS = 60 * 60;

type Purpose = "handoff" | "session" | "share" | "bypass" | "guest";

export interface SessionClaims {
  userId: string;
  orgId: string;
  email: string;
  /** The deployment domain this token is valid for. Binding prevents a
   *  token minted for plane.com being replayed against autodeploy.com. */
  domain: string;
}

export interface HandoffClaims extends SessionClaims {
  /** Where the callback should send the browser after setting the cookie
   *  (a path on the deployment domain). */
  return: string;
  /** One-time-use marker. The callback may record/reject reuse (§8). */
  nonce: string;
}

interface SignedPayload {
  p: Purpose;
  exp: number;
  [key: string]: unknown;
}

export async function signHandoffToken(claims: HandoffClaims): Promise<string> {
  return sign("handoff", { ...claims }, HANDOFF_TTL_SECONDS);
}

export async function verifyHandoffToken(
  token: string,
  expectedDomain: string,
): Promise<HandoffClaims | null> {
  const payload = await verify(token, "handoff", expectedDomain);
  if (!payload) return null;
  if (
    typeof payload.userId !== "string" ||
    typeof payload.orgId !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.return !== "string" ||
    typeof payload.nonce !== "string"
  ) {
    return null;
  }
  return {
    userId: payload.userId,
    orgId: payload.orgId,
    email: payload.email,
    domain: expectedDomain,
    return: payload.return,
    nonce: payload.nonce,
  };
}

export async function signSessionCookie(claims: SessionClaims): Promise<string> {
  return sign("session", { ...claims }, SESSION_TTL_SECONDS);
}

/** Grant tokens — domain-bound, identity-free access proofs that bypass
 *  org membership:
 *   - "share"  → a shareable link an org admin hands out; the /share
 *                endpoint exchanges it for a __otter_share cookie.
 *   - "bypass" → a long-lived value CI sets in the x-otter-bypass header
 *                to skip the wall for automation.
 *  Both carry only the domain (+ purpose + exp) so a leaked grant is
 *  useless against any other deployment. See deployment-protection.md §9. */
export async function signGrantToken(
  purpose: "share" | "bypass",
  domain: string,
  ttlSeconds: number,
): Promise<string> {
  return sign(purpose, { domain }, ttlSeconds);
}

export async function verifyGrantToken(
  token: string,
  purpose: "share" | "bypass",
  expectedDomain: string,
): Promise<boolean> {
  return (await verify(token, purpose, expectedDomain)) !== null;
}

/** Guest session cookie — issued after a successful email OTP for an invited
 *  external. Deployment-scoped, time-boxed to the guest's configured session
 *  length. No org account; carries only the email + domain. */
export interface GuestClaims {
  email: string;
  domain: string;
}

export async function signGuestCookie(
  email: string,
  domain: string,
  ttlSeconds: number,
): Promise<string> {
  return sign("guest", { email, domain }, ttlSeconds);
}

export async function verifyGuestCookie(
  token: string,
  expectedDomain: string,
): Promise<GuestClaims | null> {
  const payload = await verify(token, "guest", expectedDomain);
  if (!payload || typeof payload.email !== "string") return null;
  return { email: payload.email, domain: expectedDomain };
}

export async function verifySessionCookie(
  token: string,
  expectedDomain: string,
): Promise<SessionClaims | null> {
  const payload = await verify(token, "session", expectedDomain);
  if (!payload) return null;
  if (
    typeof payload.userId !== "string" ||
    typeof payload.orgId !== "string" ||
    typeof payload.email !== "string"
  ) {
    return null;
  }
  return {
    userId: payload.userId,
    orgId: payload.orgId,
    email: payload.email,
    domain: expectedDomain,
  };
}

async function sign(
  purpose: Purpose,
  claims: Record<string, unknown>,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SignedPayload = { ...claims, p: purpose, exp: now + ttlSeconds };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

async function verify(
  token: string,
  purpose: Purpose,
  expectedDomain: string,
): Promise<(SignedPayload & Record<string, unknown>) | null> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmac(body);
  if (!timingSafeEqual(sig, expected)) return null;

  let payload: SignedPayload & Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SignedPayload &
      Record<string, unknown>;
  } catch {
    return null;
  }

  if (payload.p !== purpose) return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  // Domain binding — a token only validates against the domain it was
  // minted for. Mismatch (or missing) ⇒ reject.
  if (payload.domain !== expectedDomain) return null;

  return payload;
}

async function hmac(input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const fill = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  const bin = atob(padded + "=".repeat(fill));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
