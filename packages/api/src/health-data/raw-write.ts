/**
 * Raw payload append: probe detail and raw metric samples for new records
 * still inside the raw window. The ledger keeps what aggregates need for
 * seven days; raw keeps the rest for 48 hours (shorter under disk pressure).
 */
import { healthMetricRaw, healthProbeRaw } from "@otterdeploy/db/schema/health-data-partitioned";
import { sql } from "drizzle-orm";

import type { WriteRow } from "./write-row";

import { RAW_RETENTION_MS } from "./model";
import { intArray, nestedArray, textArray, type Tx } from "./sql";

export async function appendRaw(
  tx: Tx,
  added: readonly WriteRow[],
  ctx: { live: boolean; now: number; rawHorizon: number },
): Promise<void> {
  const rawHorizon = Math.max(ctx.rawHorizon, ctx.now - RAW_RETENTION_MS);
  const probes = added.filter((r) => r.probe !== null && r.t >= rawHorizon);
  if (probes.length > 0) {
    const col = <T>(f: (r: WriteRow) => T) => probes.map(f);
    await tx.execute(sql`
      insert into ${healthProbeRaw} (series_id, t, boot, seq, round, state, outcome, cause, lat_us, att_us, unc_ms, received_at, live, detail)
      select s, t, b, q, rd, st, o, c, lat, a::int[], u, ${ctx.now}, ${ctx.live}, dt::jsonb
        from unnest(${intArray(col((r) => r.sid))}::bigint[], ${intArray(col((r) => r.t))}::bigint[],
                    ${intArray(col((r) => r.boot))}::bigint[], ${intArray(col((r) => r.seq))}::bigint[],
                    ${intArray(col((r) => r.probe?.round ?? 0))}::bigint[], ${intArray(col((r) => r.state))}::smallint[],
                    ${intArray(col((r) => r.probe?.outcome ?? 0))}::smallint[], ${intArray(col((r) => r.probe?.cause ?? 0))}::smallint[],
                    ${intArray(col((r) => r.lat))}::int[], ${nestedArray(col((r) => r.att))}::text[],
                    ${intArray(col((r) => r.unc))}::int[], ${textArray(col((r) => JSON.stringify(r.probe?.detail ?? {})))}::text[])
             as x(s, t, b, q, rd, st, o, c, lat, a, u, dt)`);
  }
  const metrics = added.filter((r) => r.probe === null && r.vals !== null && r.t >= rawHorizon);
  if (metrics.length > 0) {
    const col = <T>(f: (r: WriteRow) => T) => metrics.map(f);
    await tx.execute(sql`
      insert into ${healthMetricRaw} (series_id, t, boot, seq, unc_ms, received_at, live, vals)
      select s, t, b, q, u, ${ctx.now}, ${ctx.live}, v::real[]
        from unnest(${intArray(col((r) => r.sid))}::bigint[], ${intArray(col((r) => r.t))}::bigint[],
                    ${intArray(col((r) => r.boot))}::bigint[], ${intArray(col((r) => r.seq))}::bigint[],
                    ${intArray(col((r) => r.unc))}::int[], ${nestedArray(col((r) => r.vals))}::text[])
             as x(s, t, b, q, u, v)`);
  }
}
