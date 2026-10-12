/**
 * Rollup publication, always inside the rollup pass's transaction: buckets
 * are upserted, and an unchanged bucket is not rewritten (no new version, no
 * WAL). Parents are rebuilt by ./rollup-parents.ts.
 */
import type { PgTable } from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";
import * as z from "zod";

import { BASE_BUCKET_MS, EVAL_REV, floorTo, LIVE_LATENESS_MS } from "./model";
import { byteaArray, intArray, nestedArray, rowsOf, type Tx, zNum } from "./sql";

export interface ProbeOut {
  s: number;
  bucket: number;
  hw: number;
  dg: Uint8Array;
  /** healthy, degraded, down, unknown, then the same four inside maintenance. */
  dur: number[];
  n: number;
  sketch: Uint8Array | null;
  att: Uint8Array | null;
}

export interface MetricOut {
  s: number;
  bucket: number;
  hw: number;
  dg: Uint8Array;
  n: number;
  cov: number;
  /** Per element; null where nothing was measured. */
  mean: (number | null)[];
  max: (number | null)[];
  /** Samples that measured each element. */
  cnt: number[];
}

/** Distinct (series, parent bucket) keys of a set of children. */
export function parents(
  children: ReadonlyArray<readonly [number, number]>,
  width: number,
): Array<[number, number]> {
  const seen = new Map<string, [number, number]>();
  for (const [s, start] of children) {
    const p = floorTo(start, width);
    seen.set(`${s}|${p}`, [s, p]);
  }
  return [...seen.values()];
}

/** Buckets that ended more than the lateness allowance ago are complete. */
const completeExpr = (widthMs: number, asOf: number) =>
  sql`x.b + ${widthMs}::bigint <= ${asOf - LIVE_LATENESS_MS}::bigint`;

export async function upsertProbe(
  tx: Tx,
  table: PgTable,
  rows: readonly ProbeOut[],
  asOf: number,
  widthMs = BASE_BUCKET_MS,
): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await tx.execute(sql`
    insert into ${table} as cur (series_id, bucket, ver, ledger_hw, eval_rev, complete, dur_ms, n, sketch, att_sketch, bdigest)
    select x.s, x.b, 1, x.hw, ${EVAL_REV}, ${completeExpr(widthMs, asOf)}, x.d::int[], x.n, x.sk, x.at, x.dg
      from unnest(${intArray(rows.map((r) => r.s))}::bigint[], ${intArray(rows.map((r) => r.bucket))}::bigint[],
                  ${intArray(rows.map((r) => r.hw))}::bigint[], ${nestedArray(rows.map((r) => r.dur))}::text[],
                  ${intArray(rows.map((r) => r.n))}::int[], ${byteaArray(rows.map((r) => r.sketch))}::bytea[],
                  ${byteaArray(rows.map((r) => r.att))}::bytea[], ${byteaArray(rows.map((r) => r.dg))}::bytea[])
           as x(s, b, hw, d, n, sk, at, dg)
    on conflict (series_id, bucket) do update
      set ver = cur.ver + 1, ledger_hw = excluded.ledger_hw, eval_rev = excluded.eval_rev,
          complete = excluded.complete, dur_ms = excluded.dur_ms, n = excluded.n,
          sketch = excluded.sketch, att_sketch = excluded.att_sketch, bdigest = excluded.bdigest
      where (cur.dur_ms, cur.n, cur.sketch, cur.att_sketch, cur.complete)
            is distinct from (excluded.dur_ms, excluded.n, excluded.sketch, excluded.att_sketch, excluded.complete)
    returning 1 as changed`);
  return rowsOf(res, z.object({ changed: zNum })).length;
}

const round3 = (xs: readonly (number | null)[]) =>
  xs.map((x) => (x === null ? null : Math.round(x * 1000) / 1000));

export async function upsertMetric(
  tx: Tx,
  table: PgTable,
  rows: readonly MetricOut[],
  asOf: number,
  widthMs = BASE_BUCKET_MS,
): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await tx.execute(sql`
    insert into ${table} as cur (series_id, bucket, ver, ledger_hw, eval_rev, complete, n, cov_ms, mean, max, cnt, bdigest)
    select x.s, x.b, 1, x.hw, ${EVAL_REV}, ${completeExpr(widthMs, asOf)}, x.n, x.c, x.mn::real[], x.mx::real[], x.ct::int[], x.dg
      from unnest(${intArray(rows.map((r) => r.s))}::bigint[], ${intArray(rows.map((r) => r.bucket))}::bigint[],
                  ${intArray(rows.map((r) => r.hw))}::bigint[], ${intArray(rows.map((r) => r.n))}::int[],
                  ${intArray(rows.map((r) => r.cov))}::int[], ${nestedArray(rows.map((r) => round3(r.mean)))}::text[],
                  ${nestedArray(rows.map((r) => round3(r.max)))}::text[], ${nestedArray(rows.map((r) => r.cnt))}::text[],
                  ${byteaArray(rows.map((r) => r.dg))}::bytea[])
           as x(s, b, hw, n, c, mn, mx, ct, dg)
    on conflict (series_id, bucket) do update
      set ver = cur.ver + 1, ledger_hw = excluded.ledger_hw, complete = excluded.complete, n = excluded.n,
          cov_ms = excluded.cov_ms, mean = excluded.mean, max = excluded.max, cnt = excluded.cnt,
          bdigest = excluded.bdigest
      where (cur.n, cur.cov_ms, cur.mean, cur.max, cur.cnt, cur.complete)
            is distinct from (excluded.n, excluded.cov_ms, excluded.mean, excluded.max, excluded.cnt, excluded.complete)
    returning 1 as changed`);
  return rowsOf(res, z.object({ changed: zNum })).length;
}
