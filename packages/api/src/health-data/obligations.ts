/**
 * Rebuild obligations: the range of base buckets an appended record can
 * change, recorded in the ingest transaction and consumed by the rollup
 * worker in the transaction that rebuilds it.
 */
import { healthRebuildPending, healthSeries } from "@otterdeploy/db/schema/health-data";
import { healthLedger } from "@otterdeploy/db/schema/health-data-partitioned";
import { sql } from "drizzle-orm";
import * as z from "zod";

import type { WriteRow } from "./write-row";

import { KIND, MAX_AUTHORITATIVE_UNCERTAINTY_MS } from "./model";
import { intArray, rowsOf, type Tx, zNum } from "./sql";

/**
 * Event-time range [lo, hi) a new record at t (uncertainty u, TTL ttl) can
 * change, given the largest TTL its series has carried.
 *
 * Lower edge: inserting a record between a predecessor P and successor S
 * moves P's cut from S.t-S.u to t-u. When S is more uncertain than the new
 * record that cut moves LATER, lengthening P back toward S.t-S.u, which can
 * be as early as t-5 min (the authoritative uncertainty bound). Starting at
 * t-u would leave that earlier bucket stale forever, so the range starts at
 * t - max(u, 5 min).
 *
 * Upper edge: the new record's own interval and P's old TTL end, both within
 * t+u+max(ttl, series max TTL).
 */
export function rebuildRange(
  r: { t: number; unc: number; ttl: number },
  seriesMaxTtl: number,
): { lo: number; hi: number } {
  return {
    lo: r.t - Math.max(r.unc, MAX_AUTHORITATIVE_UNCERTAINTY_MS),
    hi: r.t + r.unc + Math.max(r.ttl, seriesMaxTtl),
  };
}

const maxTtlRow = z.object({ id: zNum, max_ttl_ms: zNum });
const maintenanceRow = z.object({
  i: zNum,
  next_end: zNum.nullable(),
  prev_start: zNum.nullable(),
});

/**
 * A maintenance boundary changes the overlay over the whole window, not just
 * near the marker: a start reaches to its end (or, while open, to `now`), an
 * end reaches back to its start.
 */
async function maintenanceReach(
  tx: Tx,
  markers: readonly WriteRow[],
  now: number,
): Promise<Map<WriteRow, { lo: number; hi: number }>> {
  const reach = new Map<WriteRow, { lo: number; hi: number }>();
  if (markers.length === 0) return reach;
  const rows = rowsOf(
    await tx.execute(sql`
      select x.i,
             (select min(l.t) from ${healthLedger} l
               where l.series_id = x.s and l.kind = ${KIND.maintenanceEnd} and l.t > x.t) as next_end,
             (select max(l.t) from ${healthLedger} l
               where l.series_id = x.s and l.kind = ${KIND.maintenanceStart} and l.t < x.t) as prev_start
        from unnest(${intArray(markers.map((m) => m.sid))}::bigint[], ${intArray(markers.map((m) => m.t))}::bigint[])
             with ordinality as x(s, t, i)`),
    maintenanceRow,
  );
  for (const row of rows) {
    const m = markers[row.i - 1];
    if (!m) continue;
    reach.set(
      m,
      m.kind === KIND.maintenanceStart
        ? { lo: m.t, hi: Math.max(m.t, row.next_end ?? now) }
        : { lo: Math.min(m.t, row.prev_start ?? m.t), hi: m.t },
    );
  }
  return reach;
}

/** One obligation per touched series, plus the series' TTL high-water mark. */
export async function appendObligations(tx: Tx, added: readonly WriteRow[], now: number) {
  const evaluated = added.filter((r) => r.kind !== KIND.diagnostic);
  if (evaluated.length === 0) return;
  const ids = [...new Set(evaluated.map((r) => r.sid))];
  const maxTtl = new Map(
    rowsOf(
      await tx.execute(
        sql`select id, max_ttl_ms from ${healthSeries} where id = any(${intArray(ids)}::bigint[])`,
      ),
      maxTtlRow,
    ).map((r) => [r.id, r.max_ttl_ms]),
  );
  const reach = await maintenanceReach(
    tx,
    evaluated.filter((r) => r.kind === KIND.maintenanceStart || r.kind === KIND.maintenanceEnd),
    now,
  );
  const ranges = new Map<number, { lo: number; hi: number; ttl: number }>();
  for (const r of evaluated) {
    const own = rebuildRange(r, maxTtl.get(r.sid) ?? 0);
    const extra = reach.get(r) ?? own;
    const cur = ranges.get(r.sid);
    ranges.set(r.sid, {
      lo: Math.min(own.lo, extra.lo, cur?.lo ?? own.lo),
      hi: Math.max(own.hi, extra.hi, cur?.hi ?? own.hi),
      ttl: Math.max(r.kind === KIND.observation ? r.ttl : 0, cur?.ttl ?? 0),
    });
  }
  await tx.insert(healthRebuildPending).values(
    [...ranges].map(([seriesId, range]) => ({
      seriesId,
      lo: range.lo,
      hi: range.hi,
      createdAt: now,
    })),
  );
  await tx.execute(sql`
    update ${healthSeries} s set max_ttl_ms = greatest(s.max_ttl_ms, x.ttl)
      from unnest(${intArray(ids)}::bigint[], ${intArray(ids.map((id) => ranges.get(id)?.ttl ?? 0))}::int[]) as x(id, ttl)
     where s.id = x.id and x.ttl > s.max_ttl_ms`);
}
