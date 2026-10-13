/**
 * Reading the correction ledger back for a rebuild: every record that can
 * influence a range. That is the predecessor (or the anchor kept when its
 * partition was dropped), the range itself, the five-minute clock allowance
 * after it (a successor's uncertain start can cut into the range), and the
 * last maintenance boundary before it (an open window overlays the range).
 */
import { healthLedgerAnchor } from "@otterdeploy/db/schema/health-data";
import { healthLedger } from "@otterdeploy/db/schema/health-data-partitioned";
import { sql } from "drizzle-orm";
import * as z from "zod";

import {
  KIND,
  type LedgerRecord,
  MAX_AUTHORITATIVE_UNCERTAINTY_MS,
  probeStateOf,
  recordKindOf,
} from "./model";
import { type Executor, intArray, rowsOf, zNum } from "./sql";

/**
 * Arrays are read as jsonb: real[] may hold NULL elements (a metric not
 * measured that round), which the driver cannot decode natively.
 */
const nums = z.array(z.number().nullable()).nullable();
const ints = z.array(z.number()).nullable();

const ledgerRow = z.object({
  series_id: zNum,
  t: zNum,
  boot: zNum,
  seq: zNum,
  kind: zNum,
  state: zNum,
  unc_ms: zNum,
  ttl_ms: zNum,
  lat_us: zNum.nullable(),
  att_us: ints,
  vals: nums,
  rec_id: zNum,
});

export interface FetchedSeries {
  records: LedgerRecord[];
  /** Highest ledger record id among them: the bucket's ledger high-water mark. */
  highWater: number;
}

export interface RebuildRequest {
  seriesId: number;
  lo: number;
  hi: number;
}

/** Ledger records influencing [lo, hi) for each request, by series. */
export async function fetchLedger(
  executor: Executor,
  requests: readonly RebuildRequest[],
): Promise<Map<number, FetchedSeries>> {
  const out = new Map<number, FetchedSeries>();
  if (requests.length === 0) return out;
  const res = await executor.execute(sql`
    with req as (
      select * from unnest(${intArray(requests.map((r) => r.seriesId))}::bigint[],
                           ${intArray(requests.map((r) => r.lo))}::bigint[],
                           ${intArray(requests.map((r) => r.hi))}::bigint[]) as r(s, lo, hi)
    )
    select r.s as series_id, l.t, l.boot, l.seq, l.kind, l.state, l.unc_ms, l.ttl_ms, l.lat_us,
           to_jsonb(l.att_us) as att_us, to_jsonb(l.vals) as vals, l.rec_id
      from req r
      cross join lateral (
        (select t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals, rec_id from ${healthLedger}
          where series_id = r.s and t < r.lo and kind <> ${KIND.diagnostic} order by t desc, boot desc, seq desc limit 1)
        union all
        (select t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals, 0::bigint from ${healthLedgerAnchor}
          where series_id = r.s and t < r.lo)
        union all
        (select t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals, rec_id from ${healthLedger}
          where series_id = r.s and t < r.lo and kind in (${KIND.maintenanceStart}, ${KIND.maintenanceEnd})
          order by t desc limit 1)
        union all
        (select t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals, rec_id from ${healthLedger}
          where series_id = r.s and t >= r.lo and t < r.hi + ${MAX_AUTHORITATIVE_UNCERTAINTY_MS}
            and kind <> ${KIND.diagnostic})
      ) l`);
  for (const row of rowsOf(res, ledgerRow)) {
    const entry = out.get(row.series_id) ?? { records: [], highWater: 0 };
    entry.records.push({
      t: row.t,
      boot: row.boot,
      seq: row.seq,
      kind: recordKindOf(row.kind),
      state: probeStateOf(row.state),
      uncMs: row.unc_ms,
      ttlMs: row.ttl_ms,
      latUs: row.lat_us,
      attUs: row.att_us,
      vals: row.vals,
    });
    entry.highWater = Math.max(entry.highWater, row.rec_id);
    out.set(row.series_id, entry);
  }
  return out;
}
