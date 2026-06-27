import { db } from "@otterdeploy/db";
import { edgeEvent } from "@otterdeploy/db/schema/edge-event";
/**
 * DB-backed operational-event query (edge-logs Phase 3). Events are sparse, so
 * we fetch the time window from `edge_event` (newest-first, capped) and reuse
 * `filterEdgeEvents` for host-scope / category / level / search / redaction —
 * identical to the in-memory ring path. Host scoping (host OR any batch domain
 * in the caller's owned set) is done in JS rather than jsonb SQL, which is
 * cheap at this volume.
 */
import { desc, gte } from "drizzle-orm";

import type {
  EdgeEventCategory,
  EdgeEventFilter,
  EdgeEventLevel,
  EdgeEventLine,
  EdgeEventQueryResult,
} from "./types";

import { filterEdgeEvents } from "./event-ring";
import { RANGE_MS } from "./ring";

const MAX_FETCH = 10_000;

export async function queryEdgeEventsDb(
  filter: EdgeEventFilter,
  now: number,
): Promise<EdgeEventQueryResult> {
  if (filter.hosts.length === 0) return { rows: [], total: 0 };
  const since = new Date(now - RANGE_MS[filter.range]);
  const records = await db
    .select()
    .from(edgeEvent)
    .where(gte(edgeEvent.ts, since))
    .orderBy(desc(edgeEvent.ts))
    .limit(MAX_FETCH);
  // filterEdgeEvents expects ascending order (it slices the newest tail).
  const lines = records.reverse().map(rowToLine);
  return filterEdgeEvents(lines, filter, now);
}

function rowToLine(r: typeof edgeEvent.$inferSelect): EdgeEventLine {
  return {
    id: String(r.id),
    ts: r.ts.toISOString(),
    level: r.level as EdgeEventLevel,
    category: r.category as EdgeEventCategory,
    logger: r.logger,
    msg: r.msg,
    host: r.host,
    domains: r.domains,
    upstream: r.upstream,
    error: r.error,
    raw: r.raw,
  };
}
