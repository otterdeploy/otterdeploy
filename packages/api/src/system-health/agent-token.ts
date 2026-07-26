/**
 * Health-agent BOOTSTRAP credential (od-5j8.20) — the machine token minted
 * into the swarm-wide GLOBAL agent service, whose ONLY job is to authenticate
 * one call to `POST /api/agent/register` per agent process
 * start/refresh. Same idiom as authz/tokens.ts (purpose-tagged base64url
 * payload + HMAC-SHA256 over BETTER_AUTH_SECRET — no extra secret to
 * provision).
 *
 * Trust model v1 → v2 (docs/designs/server-health-agent.md): v1 used this
 * SAME token directly as the health-report bearer, shared across every node
 * and effectively long-lived (the reconciler only re-minted on image/URL
 * drift) — any holder could claim any hostname, and revoking one node meant
 * waiting for the next drift-triggered service recreation. v2 narrows this
 * token to bootstrap-only (short TTL, forces the reconciler's periodic
 * recreate to actually rotate it — see `isBootstrapTokenStale` in
 * agent-service.ts) and moves the actual reporting credential to
 * agent-credential.ts's per-node, DB-backed, immediately-revocable session
 * token. `verifyAgentToken` is kept for `agentHealthIngestHandler`'s
 * time-boxed acceptance of PRE-v2 agent tasks still running the old image
 * (see agent-ingest.ts) — every NEW agent process only ever calls
 * `verifyBootstrapToken`.
 */

import { env } from "@otterdeploy/env/server";
import { timingSafeEqual } from "@otterdeploy/shared/crypto";

const BOOTSTRAP_PURPOSE = "health-agent-bootstrap";
const BOOTSTRAP_TTL_SECONDS = 24 * 60 * 60;

// od-5j8.20 legacy compatibility: the v1 purpose tag, still verified as a
// health-report bearer (not a bootstrap token) by agent-ingest.ts until every
// pre-v2 agent task has cycled through a reconcile-triggered recreation.
const LEGACY_PURPOSE = "health-agent";
const LEGACY_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface BootstrapTokenPayload {
  exp: number;
  /** Mint time — agent-service.ts's reconciler forces recreation once this is
   *  older than half the TTL, independent of image/URL drift. */
  iat: number;
}

export async function mintBootstrapToken(): Promise<{ token: string; payload: BootstrapTokenPayload }> {
  const now = Math.floor(Date.now() / 1000);
  const payload: BootstrapTokenPayload = { iat: now, exp: now + BOOTSTRAP_TTL_SECONDS };
  const body = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ p: BOOTSTRAP_PURPOSE, ...payload })),
  );
  return { token: `${body}.${await hmac(body)}`, payload };
}

export async function verifyBootstrapToken(token: string): Promise<boolean> {
  return verifyPurposeTaggedToken(token, BOOTSTRAP_PURPOSE);
}

/** @deprecated od-5j8.20 transition only — mints the pre-v2 long-lived
 *  shared bearer. Not called by any new code path; kept solely so existing
 *  tests / a manual rollback can still produce a legacy-shaped token. */
export async function mintAgentToken(): Promise<string> {
  const payload = { p: LEGACY_PURPOSE, exp: Math.floor(Date.now() / 1000) + LEGACY_TTL_SECONDS };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

/** Accepts a pre-v2 shared bearer — see the module note. */
export async function verifyAgentToken(token: string): Promise<boolean> {
  return verifyPurposeTaggedToken(token, LEGACY_PURPOSE);
}

async function verifyPurposeTaggedToken(token: string, purpose: string): Promise<boolean> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;
  const body = token.slice(0, idx);
  if (!timingSafeEqual(token.slice(idx + 1), await hmac(body))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as {
      p?: string;
      exp?: number;
    };
    return payload.p === purpose && typeof payload.exp === "number"
      ? payload.exp >= Math.floor(Date.now() / 1000)
      : false;
  } catch {
    return false;
  }
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
