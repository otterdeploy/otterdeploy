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

import { env } from "@otterstack/env/server";

const TTL_SECONDS = 15 * 60;

export interface InstallState {
  orgId: string;
  userId: string;
}

export async function signInstallState(state: InstallState): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...state, exp: now + TTL_SECONDS };
  const enc = new TextEncoder();
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

export async function verifyInstallState(
  token: string,
): Promise<InstallState | null> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmac(body);
  if (!timingSafeEqual(sig, expected)) return null;

  let payload: InstallState & { exp: number };
  try {
    const json = new TextDecoder().decode(base64UrlDecode(body));
    payload = JSON.parse(json) as InstallState & { exp: number };
  } catch {
    return null;
  }
  if (
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return { orgId: payload.orgId, userId: payload.userId };
}

async function hmac(input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input),
  );
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
