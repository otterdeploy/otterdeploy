/**
 * Single-use, short-lived, target-bound tickets that authenticate the /pty
 * WebSocket upgrade (od-5j8.9). Replaces ambient-cookie / query-string-bearer
 * auth on the upgrade itself: a browser cannot set headers on a WebSocket
 * handshake, so SOME piece of the URL has to carry proof of authorization —
 * but a long-lived credential there (a session cookie riding along, or the
 * old `?token=` API-key/bearer fallback) is exactly what makes cross-site
 * WebSocket hijacking and URL-leak replay possible. A ticket fixes both:
 * it's minted by an authenticated, step-up-verified RPC call (never derivable
 * from the WS request alone), it's good for seconds, and `consumeTerminalTicket`
 * atomically deletes it on first read (Redis GETDEL) — a captured/replayed
 * ticket fails the second time no matter how fast the replay is.
 *
 * Same Redis-TTL-token shape as the existing deploy-protection handoff nonce
 * (../../authz/nonce.ts) and guest OTP (../../authz/otp.ts) — not a new
 * pattern, the same primitive applied to a new caller.
 */
import type { RedisClient } from "bun";

import { Result, TaggedError } from "better-result";

import type { TerminalTarget } from "./authorize";

import { createRedis } from "../../lib/redis";

/** Long enough for the browser to read the mint response and immediately
 *  open the WebSocket; short enough that a leaked ticket (browser history,
 *  a proxy log, a Referer header) is worthless within seconds. */
const TICKET_TTL_SECONDS = 20;

let client: RedisClient | null = null;
function redis(): RedisClient {
  if (!client) client = createRedis();
  return client;
}

const ticketKey = (token: string) => `terminal:ticket:${token}`;

export interface TerminalTicketClaims {
  userId: string;
  organizationId: string;
  target: TerminalTarget;
  /** Best-effort — null when the request carried no resolvable address. */
  clientIp: string | null;
}

export class TerminalTicketError extends TaggedError("TerminalTicketError")<{
  status: 401 | 403;
  reason: "invalid_or_replayed" | "ip_mismatch";
  message: string;
}>() {}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** Mint a fresh single-use ticket bound to `claims`. `SET NX` (rather than a
 *  plain `SET`) makes minting itself fail closed on a token collision instead
 *  of silently overwriting a live ticket — with a 256-bit token the
 *  collision path is never taken in practice, but the failure mode if it
 *  ever were should be "retry", not "clobber someone else's grant".
 *
 *  `ttlSeconds` defaults to the production window and exists as a parameter
 *  purely so tests can exercise real Redis-expiry behavior on a short TTL
 *  instead of the 20s production value. */
export async function mintTerminalTicket(
  claims: TerminalTicketClaims,
  ttlSeconds: number = TICKET_TTL_SECONDS,
): Promise<{ token: string; expiresAt: Date }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomToken();
    const res = await redis().set(
      ticketKey(token),
      JSON.stringify(claims),
      "NX",
      "EX",
      String(ttlSeconds),
    );
    if (res === "OK") {
      return { token, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    }
  }
  throw new Error("terminal ticket mint: token collision on every attempt");
}

/**
 * Atomically read-and-delete a ticket. `GETDEL` is a single round trip with
 * no read-then-write gap, so two upgrade attempts racing the same ticket
 * (the classic replay window) can never both see a value — only one wins,
 * the other gets `invalid_or_replayed` exactly as a genuine replay would.
 */
export async function consumeTerminalTicket(
  token: string,
  opts: { clientIp: string | null },
): Promise<Result<TerminalTicketClaims, TerminalTicketError>> {
  const raw = await redis().send("GETDEL", [ticketKey(token)]);
  if (typeof raw !== "string") {
    return Result.err(
      new TerminalTicketError({
        status: 401,
        reason: "invalid_or_replayed",
        message: "This ticket is invalid, expired, or has already been used.",
      }),
    );
  }

  let claims: TerminalTicketClaims;
  try {
    claims = JSON.parse(raw) as TerminalTicketClaims;
  } catch {
    return Result.err(
      new TerminalTicketError({
        status: 401,
        reason: "invalid_or_replayed",
        message: "This ticket is invalid, expired, or has already been used.",
      }),
    );
  }

  // Best-effort IP binding: only enforced when BOTH ends resolved an
  // address. The ticket is already burned above either way (GETDEL already
  // ran) — a rejected-on-IP-mismatch ticket cannot be retried, same as any
  // other consumption.
  if (claims.clientIp && opts.clientIp && claims.clientIp !== opts.clientIp) {
    return Result.err(
      new TerminalTicketError({
        status: 403,
        reason: "ip_mismatch",
        message: "This ticket was issued to a different client address.",
      }),
    );
  }

  return Result.ok(claims);
}
