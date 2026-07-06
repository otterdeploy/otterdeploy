/**
 * Health-agent credential — the machine token remote nodes present when
 * POSTing health reports. Same idiom as authz/tokens.ts (purpose-tagged
 * base64url payload + HMAC-SHA256 over BETTER_AUTH_SECRET — no extra secret
 * to provision), but standalone: those tokens are deployment-domain-bound,
 * this one is install-bound with nothing else to pin.
 *
 * Trust model v1 (docs/designs/server-health-agent.md): one token per agent
 * service generation; any holder can claim any hostname. That's acceptable —
 * agents run on swarm member nodes, which are already trusted with workloads;
 * the token gates outsiders, not peers. The reconciler re-mints whenever it
 * (re)creates the agent service (every platform update), so the long TTL is a
 * ceiling, not the expected rotation cadence.
 */

import { env } from "@otterdeploy/env/server";
import { timingSafeEqual } from "@otterdeploy/shared/crypto";

const PURPOSE = "health-agent";
const TTL_SECONDS = 365 * 24 * 60 * 60;

export async function mintAgentToken(): Promise<string> {
  const payload = { p: PURPOSE, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

export async function verifyAgentToken(token: string): Promise<boolean> {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;
  const body = token.slice(0, idx);
  if (!timingSafeEqual(token.slice(idx + 1), await hmac(body))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as {
      p?: string;
      exp?: number;
    };
    return payload.p === PURPOSE && typeof payload.exp === "number"
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
