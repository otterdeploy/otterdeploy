import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Short-lived claims that make a create idempotent across a double submit or a
 * retried request. A create that must happen once claims a key
 * that names it (the organization, the actor, what is being made) for a short
 * window; a second identical request inside the window finds the claim taken
 * and is refused instead of making a second copy. The claim is one atomic
 * upsert, so two requests in flight at the same moment cannot both win it, on
 * one control-plane process or several. See ../request-claim.ts.
 */
export const requestClaim = pgTable(
  "request_claim",
  {
    key: text("key").primaryKey(),
    /** When the claim lapses and the same key may be claimed again. */
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [index("request_claim_expires_at_idx").on(table.expiresAt)],
);
