/**
 * The ingest transaction: horizon screening, identity check, ledger append,
 * raw payloads and rebuild obligations commit together or not at all, so a
 * committed record can never lack its rebuild obligation.
 *
 * Horizons are read inside the transaction under FOR SHARE. Retention
 * publishes a new horizon by UPDATE-ing those rows, which waits out every
 * in-flight batch that read the old value, and only drops partitions after
 * that publish commits. So no batch ever inserts into a partition being
 * dropped: a batch holding the old horizon either commits first or sees the
 * new one and rejects the expired rows as too old.
 */
import { db } from "@otterdeploy/db";
import { healthBatch, healthMeta, healthRejected } from "@otterdeploy/db/schema/health-data";
import { healthLedger } from "@otterdeploy/db/schema/health-data-partitioned";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import * as z from "zod";

import type { WriteRow } from "./write-row";

import { appendObligations } from "./obligations";
import { appendRaw } from "./raw-write";
import { bumpCounter } from "./series";
import {
  byteaArray,
  type HealthDbError,
  intArray,
  nestedArray,
  rowsOf,
  toDbError,
  type Tx,
  zBytes,
  zNum,
} from "./sql";

const REJECT = { tooOld: 1, contradiction: 2 } as const;

export interface WriteResult {
  /** The batch id was already ingested: nothing was written. */
  duplicateBatch: boolean;
  accepted: number;
  duplicates: number;
  contradictions: number;
  /** Behind the replay horizon read inside the transaction. */
  tooOld: number;
}

const horizonRow = z.object({ k: z.string(), v: zNum });

async function readHorizons(tx: Tx): Promise<{ horizon: number; rawHorizon: number }> {
  const rows = rowsOf(
    await tx.execute(
      sql`select k, v from ${healthMeta} where k in ('horizon_ms', 'raw_horizon_ms') for share`,
    ),
    horizonRow,
  );
  return {
    horizon: rows.find((r) => r.k === "horizon_ms")?.v ?? 0,
    rawHorizon: rows.find((r) => r.k === "raw_horizon_ms")?.v ?? 0,
  };
}

async function reject(tx: Tx, rows: readonly WriteRow[], reason: number, now: number) {
  if (rows.length === 0) return;
  await tx.insert(healthRejected).values(
    rows.map((r) => ({
      seriesId: r.sid,
      t: r.t,
      boot: r.boot,
      seq: r.seq,
      reason,
      receivedAt: now,
    })),
  );
}

const identityHit = z.object({ i: zNum, lt: zNum, ld: zBytes });

/**
 * Same identity (series, boot, sequence) already in the ledger: the same time
 * and digest is a duplicate; anything else is a contradiction, rejected and
 * audited, never a correction.
 */
async function identityCheck(tx: Tx, rows: readonly WriteRow[], now: number) {
  const hits = rowsOf(
    await tx.execute(sql`
      select u.i, l.t as lt, l.digest as ld
        from unnest(${intArray(rows.map((r) => r.sid))}::bigint[], ${intArray(rows.map((r) => r.boot))}::bigint[],
                    ${intArray(rows.map((r) => r.seq))}::bigint[]) with ordinality as u(s, b, q, i)
        join ${healthLedger} l on l.series_id = u.s and l.boot = u.b and l.seq = u.q`),
    identityHit,
  );
  const seen = new Set<number>();
  const contradicting: WriteRow[] = [];
  let duplicates = 0;
  for (const hit of hits) {
    const index = hit.i - 1;
    const row = rows[index];
    if (!row || seen.has(index)) continue;
    seen.add(index);
    if (hit.lt === row.t && Buffer.from(hit.ld).equals(row.digest)) duplicates++;
    else contradicting.push(row);
  }
  await reject(tx, contradicting, REJECT.contradiction, now);
  if (contradicting.length > 0)
    await tx.execute(bumpCounter("contradictions", contradicting.length));
  return {
    fresh: rows.filter((_, i) => !seen.has(i)),
    duplicates,
    contradictions: contradicting.length,
  };
}

const insertedKey = z.object({ series_id: zNum, t: zNum, boot: zNum, seq: zNum });
const keyOf = (r: { sid: number; t: number; boot: number; seq: number }) =>
  `${r.sid}|${r.t}|${r.boot}|${r.seq}`;

/** Ledger append; same-batch duplicates fall to ON CONFLICT. Returns the rows inserted. */
async function appendLedger(tx: Tx, fresh: readonly WriteRow[]): Promise<WriteRow[]> {
  const col = <T>(f: (r: WriteRow) => T) => fresh.map(f);
  const inserted = rowsOf(
    await tx.execute(sql`
      insert into ${healthLedger} (series_id, t, boot, seq, kind, state, unc_ms, ttl_ms, lat_us, att_us, vals, digest)
      select s, t, b, q, k, st, u, ttl, lat, a::int[], v::real[], d
        from unnest(${intArray(col((r) => r.sid))}::bigint[], ${intArray(col((r) => r.t))}::bigint[],
                    ${intArray(col((r) => r.boot))}::bigint[], ${intArray(col((r) => r.seq))}::bigint[],
                    ${intArray(col((r) => r.kind))}::smallint[], ${intArray(col((r) => r.state))}::smallint[],
                    ${intArray(col((r) => r.unc))}::int[], ${intArray(col((r) => r.ttl))}::int[],
                    ${intArray(col((r) => r.lat))}::int[], ${nestedArray(col((r) => r.att))}::text[],
                    ${nestedArray(col((r) => r.vals))}::text[], ${byteaArray(col((r) => r.digest))}::bytea[])
             as x(s, t, b, q, k, st, u, ttl, lat, a, v, d)
      on conflict do nothing
      returning series_id, t, boot, seq`),
    insertedKey,
  );
  const isNew = new Set(inserted.map((r) => keyOf({ ...r, sid: r.series_id })));
  return fresh.filter((r) => isNew.has(keyOf(r)));
}

const claimedRow = z.object({ claimed: z.literal(1) });

/**
 * Record the batch id in the same transaction as its rows: a resend that
 * arrives later (or concurrently, waiting on this row's lock) is a no-op.
 */
async function claimBatch(tx: Tx, batch: { sourceNodeId: string; batchId: string }, now: number) {
  const rows = rowsOf(
    await tx.execute(sql`
      insert into ${healthBatch} (source_node_id, batch_id, received_at)
      values (${batch.sourceNodeId}, ${batch.batchId}, ${now})
      on conflict do nothing returning 1 as claimed`),
    claimedRow,
  );
  return rows.length > 0;
}

const NOTHING = { duplicateBatch: false, accepted: 0, duplicates: 0, contradictions: 0 };

export function writeRows(
  rows: readonly WriteRow[],
  ctx: { live: boolean; now: number; batch: { sourceNodeId: string; batchId: string } | null },
): Promise<Result<WriteResult, HealthDbError>> {
  return Result.tryPromise({
    catch: toDbError,
    try: () =>
      db.transaction(async (tx) => {
        if (ctx.batch !== null && !(await claimBatch(tx, ctx.batch, ctx.now))) {
          return { ...NOTHING, duplicateBatch: true, tooOld: 0 };
        }
        const { horizon, rawHorizon } = await readHorizons(tx);
        const inside = rows.filter((r) => r.t >= horizon);
        await reject(
          tx,
          rows.filter((r) => r.t < horizon),
          REJECT.tooOld,
          ctx.now,
        );
        const tooOld = rows.length - inside.length;
        if (inside.length === 0) return { ...NOTHING, tooOld };
        const { fresh, duplicates, contradictions } = await identityCheck(tx, inside, ctx.now);
        if (fresh.length === 0) return { ...NOTHING, duplicates, contradictions, tooOld };
        const added = await appendLedger(tx, fresh);
        await appendRaw(tx, added, { ...ctx, rawHorizon });
        await appendObligations(tx, added, ctx.now);
        return {
          duplicateBatch: false,
          accepted: added.length,
          duplicates: duplicates + fresh.length - added.length,
          contradictions,
          tooOld,
        };
      }),
  });
}
