/**
 * Install-state signing.
 *
 * The GitHub App install flow round-trips through a `state` querystring
 * param so the callback can verify (a) the request originated from our
 * own start-connect endpoint and (b) which org it belongs to.
 *
 * Token shape: base64url(JSON({orgId, userId, exp})).hmac
 *  - exp: unix seconds, 15 minutes from issue
 *  - HMAC uses BETTER_AUTH_SECRET (no separate secret to provision)
 *
 * Timing-safe compare on verify.
 */

import { env } from "@otterdeploy/env/server";
import { base64UrlDecode, base64UrlEncode, timingSafeEqual } from "@otterdeploy/shared/crypto";
import * as z from "zod";

const TTL_SECONDS = 15 * 60;

/** Wire shape of the signed state payload: {@link InstallState} plus `exp`.
 *  Parsed (not cast) on verify; the HMAC already vouches for provenance, the
 *  schema vouches for shape. */
const installStatePayloadSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  host: z.string().optional(),
  returnTo: z.string().optional(),
  exp: z.number(),
});

export interface InstallState {
  orgId: string;
  userId: string;
  /** GitHub host the App is being created on. "github.com" (default) or a
   *  GHE hostname. Carried through so the manifest callback exchanges the code
   *  against the right API and stores the host on the provider row. */
  host?: string;
  /** Dashboard-relative path (+ optional query) to send the operator back to
   *  after the install completes: e.g. the deploy wizard they started from.
   *  Absent → the default landing (Git providers page). */
  returnTo?: string;
}

/**
 * Only accept an app-relative path as a post-install return target. Anything
 * else (absolute URL, protocol-relative `//`, oversized junk) would turn the
 * callback into an open redirect. Drop it and fall back to the default.
 */
export function sanitizeReturnTo(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return undefined;
  if (raw.length > 512) return undefined;
  return raw;
}

export async function signInstallState(state: InstallState): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...state, exp: now + TTL_SECONDS };
  const enc = new TextEncoder();
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifyInstallState(token: string): Promise<InstallState | null> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmac(body);
  if (!timingSafeEqual(sig, expected)) return null;

  let payload: InstallState & { exp: number };
  try {
    const json = new TextDecoder().decode(base64UrlDecode(body));
    const parsed = installStatePayloadSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    payload = parsed.data;
  } catch {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return {
    orgId: payload.orgId,
    userId: payload.userId,
    host: payload.host,
    // Re-sanitize on the way out: the token is signed, but defense-in-depth
    // keeps a future signing bug from becoming an open redirect.
    returnTo: sanitizeReturnTo(payload.returnTo),
  };
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
