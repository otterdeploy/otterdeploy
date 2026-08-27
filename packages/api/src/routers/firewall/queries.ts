import type { BlocklistId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { blocklist } from "@otterdeploy/db/schema/blocklist";
import { firewallDecision } from "@otterdeploy/db/schema/firewall-decision";
/**
 * Blocklist row CRUD + the "which lists are due for a re-sync" query the
 * recurring job uses, and the recorded-decision reads behind the History tab.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

export type BlocklistRow = typeof blocklist.$inferSelect;

export async function listBlocklists(): Promise<BlocklistRow[]> {
  return db.select().from(blocklist).orderBy(asc(blocklist.createdAt));
}

export async function getBlocklist(id: BlocklistId): Promise<BlocklistRow | undefined> {
  const [row] = await db.select().from(blocklist).where(eq(blocklist.id, id)).limit(1);
  return row;
}

export async function findBlocklistByUrl(url: string): Promise<BlocklistRow | undefined> {
  const [row] = await db.select().from(blocklist).where(eq(blocklist.url, url)).limit(1);
  return row;
}

export async function findBlocklistByCatalog(slug: string): Promise<BlocklistRow | undefined> {
  const [row] = await db.select().from(blocklist).where(eq(blocklist.catalogSlug, slug)).limit(1);
  return row;
}

export async function insertBlocklist(input: {
  name: string;
  url: string;
  catalogSlug?: string | null;
  durationHours: number;
  intervalMinutes: number;
}): Promise<BlocklistRow> {
  const [row] = await db
    .insert(blocklist)
    .values({
      name: input.name,
      url: input.url,
      catalogSlug: input.catalogSlug ?? null,
      durationHours: input.durationHours,
      intervalMinutes: input.intervalMinutes,
      lastStatus: "pending",
    })
    .returning();
  if (!row) throw new Error("Failed to insert blocklist");
  return row;
}

export async function setBlocklistEnabled(
  id: BlocklistId,
  enabled: boolean,
): Promise<BlocklistRow | undefined> {
  const [row] = await db
    .update(blocklist)
    .set(
      enabled
        ? { enabled, lastStatus: "pending", lastError: null }
        : { enabled, activeScenario: null },
    )
    .where(eq(blocklist.id, id))
    .returning();
  return row;
}

export async function setBlocklistSyncResult(
  id: BlocklistId,
  result:
    | { status: "ok"; count: number; activeScenario: string }
    | { status: "error"; error: string }
    | { status: "pending" },
): Promise<void> {
  await db
    .update(blocklist)
    .set({
      lastStatus: result.status,
      lastSyncedAt: result.status === "pending" ? undefined : new Date(),
      lastCount: result.status === "ok" ? result.count : undefined,
      lastError: result.status === "error" ? result.error.slice(0, 500) : null,
      activeScenario: result.status === "ok" ? result.activeScenario : undefined,
    })
    .where(eq(blocklist.id, id));
}

export async function deleteBlocklist(id: BlocklistId): Promise<void> {
  await db.delete(blocklist).where(eq(blocklist.id, id));
}

/** Enabled lists whose `intervalMinutes` has elapsed since the last sync (or
 *  that have never synced). The recurring job's work queue. */
export async function listBlocklistsDue(now: Date): Promise<BlocklistRow[]> {
  return db
    .select()
    .from(blocklist)
    .where(
      and(
        eq(blocklist.enabled, true),
        or(
          isNull(blocklist.lastSyncedAt),
          lt(
            blocklist.lastSyncedAt,
            // Cast the bound Date to a timestamp. Without it the param arrives
            // untyped and Postgres coerces `$now - interval` into an interval,
            // failing with "operator does not exist: timestamp < interval".
            sql`${now}::timestamptz - (${blocklist.intervalMinutes} * interval '1 minute')`,
          ),
        ),
      ),
    );
}

/**
 * Recorded decisions, live ones first, then most recently ended.
 *
 * `since` filters on `lastSeenAt` rather than `firstSeenAt`: a ban that opened
 * two days ago and is still being enforced belongs in the "last hour" view —
 * it is active right now — while one that opened and ended before the window
 * does not.
 */
export async function listRecordedDecisions(input: {
  since: Date | null;
  state: "all" | "active" | "ended";
  limit: number;
}) {
  const filters = [
    input.since ? gte(firewallDecision.lastSeenAt, input.since) : undefined,
    input.state === "active" ? isNull(firewallDecision.endedAt) : undefined,
    input.state === "ended" ? isNotNull(firewallDecision.endedAt) : undefined,
  ].filter((f) => f !== undefined);

  return (
    db
      .select()
      .from(firewallDecision)
      .where(filters.length > 0 ? and(...filters) : undefined)
      // Live rows first (endedAt NULL sorts last under DESC in postgres, so
      // NULLS FIRST is explicit), then newest activity.
      .orderBy(sql`${firewallDecision.endedAt} desc nulls first`, desc(firewallDecision.lastSeenAt))
      .limit(input.limit)
  );
}
