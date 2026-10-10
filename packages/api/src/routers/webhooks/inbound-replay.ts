/**
 * Seen-id store for inbound webhook calls.
 *
 * A signed timestamp bounds how long a captured request stays usable; inside
 * that window the same request would still verify, so each accepted
 * `webhook-id` is recorded per endpoint and a second delivery of it refused.
 * SET NX is the atomic test-and-set (no read-then-write race between two
 * copies of the request arriving together), the same primitive as the
 * deploy-protection handoff nonce (../../authz/nonce.ts).
 */
import type { RedisClient } from "bun";

import { sha256Hex } from "@otterdeploy/shared/crypto";
import { WEBHOOK_TOLERANCE_SECONDS } from "@otterdeploy/shared/webhook-signature";

import { createRedis } from "../../lib/redis";

/** True the first time `(endpointId, webhookId)` is seen, false after. */
export type InboundReplayGuard = (endpointId: string, webhookId: string) => Promise<boolean>;

/** Outlives both edges of the tolerance window, so an id is remembered for as
 *  long as any request carrying it could still pass the timestamp check. */
const SEEN_TTL_SECONDS = WEBHOOK_TOLERANCE_SECONDS * 2 + 60;

let client: RedisClient | null = null;
function redis(): RedisClient {
  client ??= createRedis();
  return client;
}

export const claimInboundDelivery: InboundReplayGuard = async (endpointId, webhookId) => {
  // Hashed: the id is caller-chosen, so it never becomes a raw Redis key.
  const key = `webhook:inbound:seen:${endpointId}:${await sha256Hex(webhookId)}`;
  const res = await redis().set(key, "1", "NX", "EX", String(SEEN_TTL_SECONDS));
  return res === "OK";
};
