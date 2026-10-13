/**
 * The health_data migration applies (the suite's global setup migrated this
 * database with the real migrations) and its partitioned parents accept
 * child partitions created ahead by the maintenance function.
 */
import { db } from "@otterdeploy/db";
import { healthSeries } from "@otterdeploy/db/schema/health-data";
import { healthLedger } from "@otterdeploy/db/schema/health-data-partitioned";
import { Result } from "better-result";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { seedOrganization } from "../../__tests__/postgres-seed";
import { DAY, HOUR } from "../model";
import {
  ensurePartitionsAhead,
  ensurePartitions,
  listPartitions,
  PARTITIONS,
  partitionSpec,
} from "../partitions";
import { rowsOf } from "../sql";

/** A fixed day far from any other suite's data. */
const NOW = 1_900_000_000_000 - (1_900_000_000_000 % DAY);

const relkinds = z.object({ relname: z.string(), relkind: z.string() });

describe("health data partitions", () => {
  it("creates every partitioned parent as a partitioned table", async () => {
    const res = await db.execute(sql`
      select relname, relkind::text as relkind from pg_class
       where relname = any(${`{${PARTITIONS.map((p) => p.table).join(",")}}`}::text[])`);
    const rows = rowsOf(res, relkinds);
    expect(rows.map((r) => r.relname).toSorted()).toEqual(
      PARTITIONS.map((p) => p.table).toSorted(),
    );
    expect(new Set(rows.map((r) => r.relkind))).toEqual(new Set(["p"]));
  });

  it("creates partitions ahead for every table, idempotently, aligned to the width", async () => {
    const first = (await ensurePartitionsAhead(NOW)).unwrap();
    expect(first).toBeGreaterThan(0);
    const again = (await ensurePartitionsAhead(NOW)).unwrap();
    expect(again).toBe(0);
    for (const spec of PARTITIONS) {
      const parts = (await listPartitions(spec)).unwrap();
      const covering = parts.filter((p) => p.start <= NOW && NOW < p.start + spec.widthMs);
      expect(covering).toHaveLength(1);
      expect(parts.every((p) => p.start % spec.widthMs === 0)).toBe(true);
      expect(parts.at(-1)?.start).toBeGreaterThan(NOW);
    }
  });

  it("routes a ledger row into its partition and refuses one outside every partition", async () => {
    const spec = partitionSpec("health_ledger");
    (await ensurePartitions(spec, NOW, NOW + DAY)).unwrap();
    const organizationId = await seedOrganization("health-partitions");
    const [series] = await db
      .insert(healthSeries)
      .values({
        organizationId,
        kind: 1,
        sourceNodeId: "node-p",
        identityKey: `partitions-${organizationId}`,
        subjectId: "svc",
        nodeDimension: false,
        createdAt: NOW,
      })
      .returning({ id: healthSeries.id });
    const row = {
      seriesId: series?.id ?? -1,
      t: NOW + HOUR,
      boot: 1,
      seq: 1,
      kind: 0,
      state: 0,
      uncMs: 0,
      ttlMs: 60_000,
      digest: Buffer.from([1]),
    };
    await db.insert(healthLedger).values(row);
    const parts = await db.execute(
      sql`select tableoid::regclass::text as relname, rec_id from ${healthLedger} where t = ${row.t}`,
    );
    const [hit] = rowsOf(parts, z.object({ relname: z.string(), rec_id: z.coerce.number() }));
    expect(hit?.relname).toBe(`health_ledger_p${(NOW / 1000).toString()}`);
    expect(hit?.rec_id).toBeGreaterThan(0);
    const far = await Result.tryPromise(() =>
      db.insert(healthLedger).values({ ...row, t: NOW + 400 * DAY }),
    );
    expect(far.isErr()).toBe(true);
  });
});
