/**
 * Claim-once keys for creates that must not happen twice.
 *
 * A double-clicked submit, two CLI runs at once, or a client retrying after it
 * lost the response all send the same create again. For most writes the second
 * copy is harmless or refused by a natural unique key; for an API key it is a
 * second live credential whose secret nobody saw, and for an invitation a
 * second email. `claimRequest` lets such a create claim a key that names it
 * for a short window: the first request wins the claim, every identical one
 * inside the window does not.
 *
 * One atomic upsert decides it: a fresh key inserts, an expired one is taken
 * over, a live one is left alone and the caller learns it lost. Postgres takes
 * the row lock for the conflicting insert, so two requests racing for the same
 * key serialize on it and exactly one of them sees its row returned.
 */
import { eq, lt, sql } from "drizzle-orm";

import { db } from "./client";
import { requestClaim } from "./schema/request-claim";

/** Claims older than this past their expiry are swept on the next claim. */
const SWEEP_AFTER = sql`interval '1 hour'`;

/**
 * Claims `key` for `windowSeconds`. True when this request holds the claim;
 * false when an identical request claimed it within the window.
 */
export async function claimRequest(key: string, windowSeconds: number): Promise<boolean> {
  await db.delete(requestClaim).where(lt(requestClaim.expiresAt, sql`now() - ${SWEEP_AFTER}`));
  const claimed = await db
    .insert(requestClaim)
    .values({ key, expiresAt: sql`now() + make_interval(secs => ${windowSeconds})` })
    .onConflictDoUpdate({
      target: requestClaim.key,
      set: { expiresAt: sql`excluded.expires_at` },
      setWhere: lt(requestClaim.expiresAt, sql`now()`),
    })
    .returning({ key: requestClaim.key });
  return claimed.length > 0;
}

/**
 * Gives a claim back, for a create that failed: the request did nothing, so a
 * corrected resubmit must not be refused as a duplicate of it.
 */
export async function releaseRequest(key: string): Promise<void> {
  await db.delete(requestClaim).where(eq(requestClaim.key, key));
}
