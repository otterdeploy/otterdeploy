/**
 * pruneSchedulesForDeletedResource against a real Postgres: the candidate
 * query is jsonb containment over `backup_schedule.sources`, and a containment
 * whose right side is a JSON-encoded string PARAMETER binds as a jsonb string
 * that no array contains. The query then matched nothing and a schedule kept a
 * deleted database as its source forever; only a real database shows it.
 */
import { db } from "@otterdeploy/db";
import { backupSchedule } from "@otterdeploy/db/schema/backup";
import { idSchema } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, uniq } from "../../__tests__/postgres-seed";
import { pruneSchedulesForDeletedResource } from "../schedule-cleanup";

describe("pruneSchedulesForDeletedResource", () => {
  it("drops the deleted database from a schedule's sources and disables the schedule it emptied", async () => {
    const organizationId = await seedOrganization(`prune-${uniq()}`);
    const resourceId = idSchema.resource.parse(
      `res_${`gone${uniq()}`
        .toLowerCase()
        .replaceAll(/[^a-z0-9]/g, "")
        .padEnd(24, "0")
        .slice(0, 24)}`,
    );
    const [row] = await db
      .insert(backupSchedule)
      .values({
        organizationId,
        name: `nightly-${uniq()}`,
        cron: "0 3 * * *",
        sources: [resourceId],
      })
      .returning({ id: backupSchedule.id });
    if (!row) throw new Error("schedule insert returned no row");

    await pruneSchedulesForDeletedResource({ organizationId, resourceId, resourceName: "gone-db" });

    const [after] = await db
      .select({ sources: backupSchedule.sources, enabled: backupSchedule.enabled })
      .from(backupSchedule)
      .where(eq(backupSchedule.id, row.id));
    expect(after).toEqual({ sources: [], enabled: false });
  });
});
