/**
 * Control-plane boundaries in the ledger: a check deletion tombstones every
 * series of the check, on every node and vantage; a maintenance window marks
 * every series of its scope; a retried call changes nothing.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { healthSeries } from "@otterdeploy/db/schema/health-data";
import { healthLedger } from "@otterdeploy/db/schema/health-data-partitioned";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization } from "../../__tests__/postgres-seed";
import { recordControlPlaneMarker } from "../cp-markers";
import { Ingestor } from "../ingest";
import { identityKey, type SeriesIdentity } from "../ingest-model";
import { DAY, HOUR, KIND, MINUTE, STATE } from "../model";
import { batch, metric, metricSeries, prepareWindow, probe, probeSeries } from "./fixtures";

const NOW = 1_950_000_000_000 - (1_950_000_000_000 % DAY) + 12 * HOUR;
let org: OrganizationId;

async function kindsOf(identity: SeriesIdentity): Promise<number[]> {
  const [series] = await db
    .select({ id: healthSeries.id })
    .from(healthSeries)
    .where(eq(healthSeries.identityKey, identityKey(identity)))
    .$withCache(false);
  const rows = await db
    .select({ kind: healthLedger.kind })
    .from(healthLedger)
    .where(eq(healthLedger.seriesId, series?.id ?? -1))
    .orderBy(healthLedger.t)
    .$withCache(false);
  return rows.map((r) => r.kind);
}

describe("control-plane markers", () => {
  beforeAll(async () => {
    await prepareWindow(NOW);
    org = await seedOrganization("health-cp-markers");
  });

  it("a check deletion tombstones every series of the check, on every node and vantage, once", async () => {
    const x = probeSeries(org, "deleted", "node-x");
    const y = probeSeries(org, "deleted", "node-y", { vantage: "outside" });
    const other = probeSeries(org, "kept", "node-x");
    const ing = new Ingestor();
    const t = NOW - 5 * MINUTE;
    (
      await ing.ingest(
        batch([probe(x, t, STATE.healthy), probe(other, t, STATE.healthy)], {
          sourceNodeId: "node-x",
        }),
        NOW,
      )
    ).unwrap();
    (await ing.ingest(batch([probe(y, t, STATE.down)], { sourceNodeId: "node-y" }), NOW)).unwrap();
    const marker = {
      kind: "check-deleted",
      organizationId: org,
      checkId: "deleted",
      checkRevision: null,
      at: NOW - MINUTE,
    } as const;
    const r = (await recordControlPlaneMarker(marker, { receivedAt: NOW })).unwrap();
    expect(r).toMatchObject({ markers: 2, accepted: 2, duplicateBatch: false });
    expect(await kindsOf(x)).toEqual([KIND.observation, KIND.tombstone]);
    expect(await kindsOf(y)).toEqual([KIND.observation, KIND.tombstone]);
    expect(await kindsOf(other)).toEqual([KIND.observation]);
    const again = (await recordControlPlaneMarker(marker, { receivedAt: NOW })).unwrap();
    expect(again).toMatchObject({ accepted: 0, duplicateBatch: true });
    expect(await kindsOf(x)).toEqual([KIND.observation, KIND.tombstone]);
  });

  it("a deletion of one revision leaves the other revisions alone", async () => {
    const r1 = probeSeries(org, "revised", "node-x");
    const r2 = probeSeries(org, "revised", "node-x", { checkRevision: 2 });
    const t = NOW - 5 * MINUTE;
    (
      await new Ingestor().ingest(
        batch([probe(r1, t, STATE.healthy), probe(r2, t, STATE.healthy)], {
          sourceNodeId: "node-x",
        }),
        NOW,
      )
    ).unwrap();
    const r = (
      await recordControlPlaneMarker(
        {
          kind: "check-deleted",
          organizationId: org,
          checkId: "revised",
          checkRevision: 1,
          at: NOW - MINUTE,
        },
        { receivedAt: NOW },
      )
    ).unwrap();
    expect(r.markers).toBe(1);
    expect(await kindsOf(r1)).toEqual([KIND.observation, KIND.tombstone]);
    expect(await kindsOf(r2)).toEqual([KIND.observation]);
  });

  it("a maintenance window marks every series of its subject, on every node", async () => {
    const a = metricSeries(org, "host", "node-m1", "svc-m");
    const b = metricSeries(org, "host", "node-m2", "svc-m");
    const c = metricSeries(org, "host", "node-m1", "svc-other");
    const t = NOW - 5 * MINUTE;
    const ing = new Ingestor();
    (
      await ing.ingest(
        batch([metric(a, t, [1]), metric(c, t, [1])], { sourceNodeId: "node-m1" }),
        NOW,
      )
    ).unwrap();
    (await ing.ingest(batch([metric(b, t, [1])], { sourceNodeId: "node-m2" }), NOW)).unwrap();
    for (const [kind, at] of [
      ["maintenance-start", NOW - 3 * MINUTE],
      ["maintenance-end", NOW - 2 * MINUTE],
    ] as const) {
      const r = (
        await recordControlPlaneMarker(
          { kind, organizationId: org, scope: { subjectId: "svc-m" }, at },
          { receivedAt: NOW },
        )
      ).unwrap();
      expect(r.markers).toBe(2);
    }
    const window = [KIND.observation, KIND.maintenanceStart, KIND.maintenanceEnd];
    expect(await kindsOf(a)).toEqual(window);
    expect(await kindsOf(b)).toEqual(window);
    expect(await kindsOf(c)).toEqual([KIND.observation]);
  });
});
