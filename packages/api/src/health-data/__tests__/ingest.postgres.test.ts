import { db } from "@otterdeploy/db";
import {
  healthCounters,
  healthMeta,
  healthRebuildPending,
  healthRejected,
  healthSeries,
} from "@otterdeploy/db/schema/health-data";
import { healthLedger, healthProbeRaw } from "@otterdeploy/db/schema/health-data-partitioned";
/**
 * The ingest transaction on a real Postgres: identity dedupe, audited
 * contradictions, diagnostic and too-old records, raw payload window, quotas,
 * markers, and the rebuild obligation committed with the ledger row.
 */
import { idSchema, type OrganizationId } from "@otterdeploy/shared/id";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization } from "../../__tests__/postgres-seed";
import { Ingestor } from "../ingest";
import { CONTAINER_DIMENSION_SET, identityKey, type SeriesIdentity } from "../ingest-model";
import { DAY, HOUR, KIND, MINUTE, STATE } from "../model";
import {
  batch,
  countOf,
  metric,
  metricSeries,
  prepareWindow,
  probe,
  probeSeries,
} from "./fixtures";

const NOW = 1_910_000_000_000 - (1_910_000_000_000 % DAY) + 12 * HOUR;
let org: OrganizationId;

async function seriesId(identity: SeriesIdentity): Promise<number> {
  const [row] = await db
    .select({ id: healthSeries.id })
    .from(healthSeries)
    .where(eq(healthSeries.identityKey, identityKey(identity)))
    .$withCache(false);
  return row?.id ?? -1;
}

const ledgerCount = (sid: number) =>
  countOf(sql`select count(*) as n from ${healthLedger} where series_id = ${sid}`);

describe("health ingest", () => {
  beforeAll(async () => {
    await prepareWindow(NOW);
    org = await seedOrganization("health-ingest");
  });

  it("appends the ledger, the raw payload and the rebuild obligation together; a resend is a duplicate", async () => {
    const s = probeSeries(org, "dedupe");
    const ing = new Ingestor();
    const a = probe(s, NOW - 10 * MINUTE, STATE.healthy);
    const b = probe(s, NOW - 9 * MINUTE, STATE.down);
    const first = (await ing.ingest(batch([a, b]), NOW)).unwrap();
    expect(first).toMatchObject({ accepted: 2, duplicates: 0, contradictions: 0 });
    const again = (await new Ingestor().ingest(batch([a, b, a]), NOW)).unwrap();
    expect(again).toMatchObject({ accepted: 0, duplicates: 3, contradictions: 0 });
    const sid = await seriesId(s);
    expect(await ledgerCount(sid)).toBe(2);
    expect(
      await countOf(sql`select count(*) as n from ${healthProbeRaw} where series_id = ${sid}`),
    ).toBe(2);
    const pending = await db
      .select()
      .from(healthRebuildPending)
      .where(eq(healthRebuildPending.seriesId, sid))
      .$withCache(false);
    expect(pending).toHaveLength(1);
    // Starts five minutes before the earliest record, not at t - u (u = 0 here).
    expect(pending[0]?.lo).toBe(NOW - 15 * MINUTE);
  });

  it("a resent batch id is a no-op, even concurrently, and is scoped to its node", async () => {
    const s = probeSeries(org, "batch");
    const first = (
      await new Ingestor().ingest(
        batch([probe(s, NOW - 3 * MINUTE, STATE.healthy)], { batchId: "b-1" }),
        NOW,
      )
    ).unwrap();
    expect(first).toMatchObject({ accepted: 1, duplicateBatch: false });
    const resent = (
      await new Ingestor().ingest(
        batch([probe(s, NOW - 3 * MINUTE, STATE.healthy), probe(s, NOW - 2 * MINUTE, STATE.down)], {
          batchId: "b-1",
        }),
        NOW,
      )
    ).unwrap();
    expect(resent).toMatchObject({ accepted: 0, duplicates: 0, duplicateBatch: true });
    const sid = await seriesId(s);
    expect(await ledgerCount(sid)).toBe(1);
    const concurrent = await Promise.all(
      [0, 1, 2].map(() =>
        new Ingestor().ingest(
          batch([probe(s, NOW - MINUTE, STATE.healthy)], { batchId: "b-2" }),
          NOW,
        ),
      ),
    );
    expect(concurrent.filter((r) => !r.unwrap().duplicateBatch)).toHaveLength(1);
    expect(await ledgerCount(sid)).toBe(2);
    const elsewhere = (
      await new Ingestor().ingest(batch([], { batchId: "b-1", sourceNodeId: "node-other" }), NOW)
    ).unwrap();
    expect(elsewhere.duplicateBatch).toBe(false);
  });

  it("rejects and audits a contradiction: same identity, other payload", async () => {
    const s = probeSeries(org, "contradiction");
    const ing = new Ingestor();
    (await ing.ingest(batch([probe(s, NOW - 5 * MINUTE, STATE.healthy)]), NOW)).unwrap();
    const forged = probe(s, NOW - 5 * MINUTE, STATE.down);
    const r = (await ing.ingest(batch([forged]), NOW)).unwrap();
    expect(r).toMatchObject({ accepted: 0, contradictions: 1 });
    const sid = await seriesId(s);
    const audit = await db
      .select()
      .from(healthRejected)
      .where(and(eq(healthRejected.seriesId, sid), eq(healthRejected.reason, 2)))
      .$withCache(false);
    expect(audit).toHaveLength(1);
    const [counter] = await db
      .select({ v: healthCounters.v })
      .from(healthCounters)
      .where(eq(healthCounters.k, "contradictions"))
      .$withCache(false);
    expect(counter?.v).toBeGreaterThanOrEqual(1);
    // The accepted record stands.
    const [kept] = await db
      .select({ state: healthLedger.state })
      .from(healthLedger)
      .where(eq(healthLedger.seriesId, sid))
      .$withCache(false);
    expect(kept?.state).toBe(STATE.healthy);
  });

  it("stores over-uncertain records as diagnostic history without a rebuild obligation", async () => {
    const s = probeSeries(org, "diagnostic");
    const r = (
      await new Ingestor().ingest(
        batch([probe(s, NOW - 20 * MINUTE, STATE.down, { uncMs: 5 * MINUTE + 1 })]),
        NOW,
      )
    ).unwrap();
    expect(r).toMatchObject({ accepted: 1, diagnostic: 1 });
    const sid = await seriesId(s);
    const [row] = await db
      .select({ kind: healthLedger.kind })
      .from(healthLedger)
      .where(eq(healthLedger.seriesId, sid))
      .$withCache(false);
    expect(row?.kind).toBe(KIND.diagnostic);
    expect(
      await countOf(
        sql`select count(*) as n from ${healthRebuildPending} where series_id = ${sid}`,
      ),
    ).toBe(0);
  });

  it("refuses records behind the replay horizon (audited) and too far in the future", async () => {
    const s = probeSeries(org, "horizon");
    await db
      .update(healthMeta)
      .set({ v: NOW - 2 * DAY })
      .where(eq(healthMeta.k, "horizon_ms"));
    const r = (
      await new Ingestor().ingest(
        batch([
          probe(s, NOW - 3 * DAY, STATE.healthy),
          probe(s, NOW + 2 * HOUR, STATE.healthy),
          probe(s, NOW - MINUTE, STATE.healthy),
        ]),
        NOW,
      )
    ).unwrap();
    await db.update(healthMeta).set({ v: 0 });
    expect(r).toMatchObject({ accepted: 1, tooOld: 1, future: 1 });
    const sid = await seriesId(s);
    expect(
      await countOf(
        sql`select count(*) as n from ${healthRejected} where series_id = ${sid} and reason = 1`,
      ),
    ).toBe(1);
  });

  it("keeps a record older than the raw window in the ledger only", async () => {
    const s = probeSeries(org, "raw-window");
    const old = NOW - 3 * DAY;
    const r = (await new Ingestor().ingest(batch([probe(s, old, STATE.healthy)]), NOW)).unwrap();
    expect(r.accepted).toBe(1);
    const sid = await seriesId(s);
    expect(await ledgerCount(sid)).toBe(1);
    expect(
      await countOf(sql`select count(*) as n from ${healthProbeRaw} where series_id = ${sid}`),
    ).toBe(0);
  });

  it("refuses a node's 18th non-container series; containers are not capped by it", async () => {
    const node = "node-dims";
    const dims = Array.from({ length: 25 }, (_, d) =>
      metric(metricSeries(org, `dim:${d}`, node), NOW - MINUTE, [1, 2]),
    );
    const containers = Array.from({ length: 5 }, (_, c) =>
      metric(metricSeries(org, CONTAINER_DIMENSION_SET, node, `ctr-${c}`), NOW - MINUTE, [1]),
    );
    const r = (
      await new Ingestor().ingest(batch([...dims, ...containers], { sourceNodeId: node }), NOW)
    ).unwrap();
    expect(r.quotaRejected).toBe(25 - 17);
    expect(r.accepted).toBe(17 + 5);
  });

  it("refuses series past the per-organization quota", async () => {
    const small = await seedOrganization("health-quota");
    const records = Array.from({ length: 7 }, (_, i) =>
      probe(probeSeries(small, `q${i}`), NOW - MINUTE, STATE.healthy),
    );
    const r = (
      await new Ingestor({ nodeDimensions: 17, seriesPerOrg: 5 }).ingest(batch(records), NOW)
    ).unwrap();
    expect(r).toMatchObject({ accepted: 5, quotaRejected: 2 });
  });

  it("fans a node-wide boot marker out to every series of that node", async () => {
    const node = "node-boot";
    const records = [0, 1, 2].map((i) =>
      probe(probeSeries(org, `boot${i}`, node), NOW - 2 * MINUTE, STATE.healthy),
    );
    const ing = new Ingestor();
    (await ing.ingest(batch(records, { sourceNodeId: node }), NOW)).unwrap();
    const r = (
      await ing.ingest(
        batch([], {
          sourceNodeId: node,
          markers: [{ kind: KIND.boot, t: NOW - MINUTE, seq: 1, target: { kind: "node" } }],
        }),
        NOW,
      )
    ).unwrap();
    expect(r).toMatchObject({ markers: 3, accepted: 3 });
  });

  it("a subject marker cuts only that subject's series on the node", async () => {
    const node = "node-subject";
    const host = metricSeries(org, "host", node, "host");
    const fs = metricSeries(org, "fs:/", node, "host");
    const ctr = metricSeries(org, CONTAINER_DIMENSION_SET, node, "ctr-1");
    const ing = new Ingestor();
    const t = NOW - 2 * MINUTE;
    (
      await ing.ingest(
        batch([metric(host, t, [1]), metric(fs, t, [2]), metric(ctr, t, [3])], {
          sourceNodeId: node,
        }),
        NOW,
      )
    ).unwrap();
    const cut = (subjectId: string, dimensionSet: string | null, seq: number) =>
      ing.ingest(
        batch([], {
          sourceNodeId: node,
          markers: [
            {
              kind: KIND.gapStart,
              t: NOW - MINUTE,
              seq,
              target: { kind: "subject", subjectId, dimensionSet },
            },
          ],
        }),
        NOW,
      );
    expect((await cut("host", "fs:/", 1)).unwrap().markers).toBe(1);
    expect((await cut("host", null, 2)).unwrap().markers).toBe(2);
    expect((await cut("ctr-1", null, 3)).unwrap().markers).toBe(1);
  });

  it("refuses a series of an organization that does not exist", async () => {
    const ghost = probeSeries(idSchema.organization.parse("org_doesnotexist0000000000"), "ghost");
    const r = (
      await new Ingestor().ingest(batch([probe(ghost, NOW - MINUTE, STATE.healthy)]), NOW)
    ).unwrap();
    expect(r).toMatchObject({ accepted: 0, quotaRejected: 1 });
  });

  it("a maintenance end arriving before its start still obliges a rebuild of the whole window", async () => {
    const s = probeSeries(org, "maintenance");
    const ing = new Ingestor();
    const start = NOW - 3 * HOUR;
    const end = NOW - HOUR;
    (await ing.ingest(batch([probe(s, start - MINUTE, STATE.healthy)]), NOW)).unwrap();
    const marker = (kind: 5 | 6, t: number) => ({
      kind,
      t,
      seq: t,
      target: { kind: "series" as const, identity: s },
    });
    (await ing.ingest(batch([], { markers: [marker(KIND.maintenanceEnd, end)] }), NOW)).unwrap();
    const sid = await seriesId(s);
    await db.delete(healthRebuildPending).where(eq(healthRebuildPending.seriesId, sid));
    (
      await ing.ingest(batch([], { markers: [marker(KIND.maintenanceStart, start)] }), NOW)
    ).unwrap();
    const [pending] = await db
      .select()
      .from(healthRebuildPending)
      .where(eq(healthRebuildPending.seriesId, sid))
      .$withCache(false);
    expect(pending?.lo).toBeLessThanOrEqual(start);
    expect(pending?.hi).toBeGreaterThanOrEqual(end);
  });
});
