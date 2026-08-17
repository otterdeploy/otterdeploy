/**
 * Single-use, short-lived, target-bound tickets that authenticate the /pty
 * WebSocket upgrade (od-5j8.9). Replaces ambient-cookie / query-string-bearer
 * auth on the upgrade itself: a browser cannot set headers on a WebSocket
 * handshake, so SOME piece of the URL has to carry proof of authorization,
 * but a long-lived credential there (a session cookie riding along, or the
 * old `?token=` API-key/bearer fallback) is exactly what makes cross-site
 * WebSocket hijacking and URL-leak replay possible. A ticket fixes both:
 * it's minted by an authenticated, step-up-verified RPC call (never derivable
 * from the WS request alone), it's good for seconds, and `consumeTerminalTicket`
 * atomically deletes it on first read (Redis GETDEL). A captured/replayed
 * ticket fails the second time no matter how fast the replay is.
 *
 * Same Redis-TTL-token shape as the existing deploy-protection handoff nonce
 * (../../authz/nonce.ts) and guest OTP (../../authz/otp.ts), not a new
 * pattern, the same primitive applied to a new caller.
 */
import { Result, TaggedError } from "better-result";
import * as z from "zod";

import type { TerminalTarget } from "./authorize";

import { createRedis } from "../../lib/redis";

/** Long enough for the browser to read the mint response and immediately
 *  open the WebSocket; short enough that a leaked ticket (browser history,
 *  a proxy log, a Referer header) is worthless within seconds. */
const TICKET_TTL_SECONDS = 20;

/**
 * The entire Redis surface this module uses. Narrow on purpose: it is the whole
 * contract a test double has to honour, and keeping it two methods wide is what
 * stops a double from drifting away from the real client's behaviour.
 */
export interface TicketStore {
  set(key: string, value: string, nx: "NX", ex: "EX", ttlSeconds: string): Promise<string | null>;
  send(command: string, args: string[]): Promise<unknown>;
}

let client: TicketStore | null = null;
function redis(): TicketStore {
  if (!client) client = createRedis();
  return client;
}

/**
 * Swap the ticket store. TEST ONLY, and enforced, not merely documented.
 *
 * `apps/server/.../ws.test.ts` exercises the real upgrade handler's rejection
 * paths, every one of which runs through this store. Without a seam those tests
 * open a live Redis connection, which the CI `test` job deliberately has no
 * service for (only the `integration` job gets containers, see ci.yml). The
 * result was three tests hanging ~5s on a connection that could never succeed
 * and failing on timeout, while passing locally purely because a developer
 * happens to have compose up. A hidden infra dependency in a unit test is the
 * bug; a wider timeout would only have made it a slower one.
 *
 * The `NODE_ENV` guard is because this swaps the store that authenticates
 * terminal access. Being able to replace that at runtime is not something this
 * process should be capable of, so outside tests it throws rather than accepts.
 */
export function setTicketStoreForTests(store: TicketStore | null): void {
  // oxlint-disable-next-line node/no-process-env -- guarding a test-only seam
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setTicketStoreForTests is not callable outside tests");
  }
  client = store;
}

const ticketKey = (token: string) => `terminal:ticket:${token}`;

/**
 * The address a ticket binds to. Derived by ONE function so the mint side and
 * the consume side can never drift apart. They previously each extracted it,
 * and a binding that compares two independent derivations of "the client" is a
 * bug waiting on a deployment topology to expose it.
 *
 * `x-forwarded-for` is the LAST resort, because it is not stable per client:
 * it accumulates a hop per proxy, so which entry means "the browser" depends on
 * the chain, and an edge may rewrite it differently for long-lived connections
 * than for short ones. On the otterdeploy deployment behind Cloudflare, every
 * ordinary request arrived with `X-Forwarded-For: <browser>`, while each
 * long-lived `/rpc/project/events/stream` arrived with `X-Forwarded-For:
 * <cloudflare-edge>`: same browser, same session, `Cf-Connecting-Ip` pinned to
 * the real address throughout. A `/pty` upgrade is exactly such a long-lived
 * connection: the short mint POST bound the browser's address, the upgrade
 * presented the edge's, and the comparison rejected it. Unrecoverably, too.
 * `consumeTerminalTicket` burns the ticket with GETDEL *before* the IP check,
 * so every retry minted a fresh ticket and failed identically.
 *
 * `cf-connecting-ip` / `x-real-ip` each carry a SINGLE edge-set address that
 * doesn't vary with connection lifetime, so they win when present. Trusting
 * them unconditionally is safe *here* specifically because this binding is not
 * an authorization boundary: the ticket is already user-authenticated,
 * step-up-verified, origin-checked, single-use and ~20s-lived. Forging the
 * header only lets a caller match a ticket it minted and already owns.
 */
export function ticketBindingIp(headers: Headers): string | null {
  const edgeSet = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip");
  if (edgeSet?.trim()) return edgeSet.trim();
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export interface TerminalTicketClaims {
  userId: string;
  organizationId: string;
  target: TerminalTarget;
  /** Best-effort: null when the request carried no resolvable address. */
  clientIp: string | null;
}

/** Parse schema for claims coming back out of Redis. We wrote the JSON
 *  ourselves at mint time, so a mismatch means corruption / tampering and is
 *  treated exactly like an invalid ticket. */
const terminalTicketClaimsSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("container"), id: z.string() }),
    z.object({ kind: z.literal("host") }),
  ]),
  clientIp: z.string().nullable(),
}) satisfies z.ZodType<TerminalTicketClaims>;

class TerminalTicketError extends TaggedError("TerminalTicketError")<{
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
 *  of silently overwriting a live ticket. With a 256-bit token the
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
 * (the classic replay window) can never both see a value. Only one wins,
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
    claims = terminalTicketClaimsSchema.parse(JSON.parse(raw));
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
  // ran). A rejected-on-IP-mismatch ticket cannot be retried, same as any
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
