/**
 * One-time-use guard for the cross-domain handoff token. The token already
 * carries a `nonce` + 60s TTL; recording that nonce on first use makes the
 * callback single-use, so a captured callback URL (browser history, Referer,
 * proxy logs, a shared link) can't be replayed inside the TTL window to mint
 * a second session cookie. See docs/designs/deployment-protection.md §8.
 */

import type { RedisClient } from "bun";

import { createRedis } from "../lib/redis";

/** A touch longer than the handoff token TTL (60s) so the replay guard always
 *  outlives the token it protects. */
const NONCE_TTL_SECONDS = 70;

let client: RedisClient | null = null;
function redis(): RedisClient {
  if (!client) client = createRedis();
  return client;
}

/** Atomically claim a handoff nonce. Returns true the first time it's seen,
 *  false on every replay within the TTL window. SET NX is the atomic
 *  test-and-set — no read-then-write race. */
export async function claimHandoffNonce(nonce: string): Promise<boolean> {
  const r = redis();
  const res = await r.set(
    `handoff:nonce:${nonce}`,
    "1",
    "NX",
    "EX",
    String(NONCE_TTL_SECONDS),
  );
  return res === "OK";
}
