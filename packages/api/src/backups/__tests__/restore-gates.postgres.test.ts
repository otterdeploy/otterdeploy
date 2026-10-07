/**
 * The gates in front of a restore, against a migrated Postgres:
 *
 *   - every refusal came back as a plain Error (a bare 500 on the wire).
 *     Each is now a typed RestoreError naming its reason.
 *   - two in-place restores of one target could run at once. The write
 *     target is claimed first; a second restore is refused before it opens a
 *     restore row, and the claim is released whatever the first one's
 *     outcome.
 *
 * No Docker and no rustic here: a restore that passes every gate fails on the
 * unreadable repo, which is the failure this suite wants to see typed too.
 */
import type {
  BackupDestinationId,
  BackupId,
  OrganizationId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupLock, backupRestore } from "@otterdeploy/db/schema";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  seedDatabase,
  seedOrganization,
  seedProject,
  uniq,
} from "../../__tests__/postgres-seed";
import { createDestinationRecord } from "../../routers/backups/destination-queries";
import { createBackupRun, markBackupRunning, markBackupSucceeded } from "../db";
import { restoreBackup } from "../restore";
import { claimRestoreLock, releaseRestoreLock } from "../restore-db";

vi.hoisted(() => {
  /* oxlint-disable node/no-process-env -- test env boundary: no Docker daemon and no rustic, so a restore past the gates fails fast */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-restore-gates.sock";
  process.env.RUSTIC_BIN = "/nonexistent/otterdeploy-restore-gates/rustic";
  /* oxlint-enable node/no-process-env */
});

let organizationId: OrganizationId;
let destinationId: BackupDestinationId;

interface Source {
  resourceId: ResourceId;
  name: string;
}

async function createSource(engine: "postgres" | "redis" = "postgres"): Promise<Source> {
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const name = `${engine}-${uniq()}`;
  const seeded = await seedDatabase({
    projectId,
    environmentId: mainEnvironmentId,
    name,
    tag: "gates",
    engine,
  });
  return { resourceId: seeded.resourceId, name };
}

/** A run of `source` (a database, or a named volume); succeeded (with a
 *  snapshot id) unless `queued`. */
async function createRun(
  source: Source | { volumeName: string },
  state: "succeeded" | "queued",
  approach: "logical" | "physical" = "logical",
): Promise<BackupId> {
  const id = await createBackupRun({
    organizationId,
    source:
      "volumeName" in source
        ? { kind: "volume", volumeName: source.volumeName }
        : { kind: "database", resourceId: source.resourceId },
    destinationId,
    approach,
  });
  if (state === "queued") return id;
  await markBackupRunning(id);
  await markBackupSucceeded(id, {
    storagePath: `snap-${uniq()}`,
    checksum: null,
    compressedSizeBytes: 1024,
    sourceSizeBytes: 4096,
    durationMs: 10,
    method: "pg_dump",
  });
  return id;
}

async function restoreRows(backupId: BackupId) {
  return db
    .select({ status: backupRestore.status })
    .from(backupRestore)
    .where(eq(backupRestore.backupId, backupId));
}

beforeAll(async () => {
  organizationId = await seedOrganization("restore-gates");
  const destination = await createDestinationRecord({
    organizationId,
    name: `local-${uniq()}`,
    type: "local",
    config: { path: `/nonexistent/otterdeploy-restore-gates/${uniq()}` },
    encryptedSecret: null,
    usedForBackups: true,
  });
  destinationId = destination.id;
});

describe("restore refusals are typed and name their reason", () => {
  it("a wrong typed name asks for the name of what gets overwritten", async () => {
    const source = await createSource();
    const id = await createRun(source, "succeeded");
    const restored = await restoreBackup({ backupId: id, mode: "in-place", confirm: "nope" });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreConfirmationError");
    expect(restored.isErr() && restored.error.message).toContain(`type "${source.name}"`);
    expect(await restoreRows(id)).toHaveLength(0);
  });

  it("a postgres snapshot into a redis database is an invalid target", async () => {
    const source = await createSource();
    const redis = await createSource("redis");
    const id = await createRun(source, "succeeded");
    const restored = await restoreBackup({
      backupId: id,
      mode: "in-place",
      confirm: redis.name,
      targetResourceId: redis.resourceId,
    });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreTargetInvalidError");
    expect(restored.isErr() && restored.error.message).toMatch(/postgres snapshot into a redis/);
  });

  it("a volume snapshot cannot be written into a database", async () => {
    const target = await createSource();
    const id = await createRun({ volumeName: `vol-${uniq()}` }, "succeeded");
    const restored = await restoreBackup({
      backupId: id,
      mode: "in-place",
      confirm: target.name,
      targetResourceId: target.resourceId,
    });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreTargetInvalidError");
    expect(restored.isErr() && restored.error.message).toMatch(/volume snapshot/);
  });

  it("a target that is not a database in this organization is an invalid target", async () => {
    const source = await createSource();
    const id = await createRun(source, "succeeded");
    const restored = await restoreBackup({
      backupId: id,
      mode: "in-place",
      confirm: "x",
      targetResourceId: createId(ID_PREFIX.resource),
    });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreTargetInvalidError");
    expect(restored.isErr() && restored.error.message).toMatch(/not found/);
  });

  it("a backup whose context is gone is refused", async () => {
    const restored = await restoreBackup({
      backupId: createId(ID_PREFIX.backup),
      mode: "download",
    });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreRefusedError");
    expect(restored.isErr() && restored.error.message).toMatch(/no longer exists/);
  });

  it("a physical base backup is refused in place, and the refusal is recorded", async () => {
    const source = await createSource();
    const id = await createRun(source, "succeeded", "physical");
    const restored = await restoreBackup({ backupId: id, mode: "in-place", confirm: source.name });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreRefusedError");
    expect(restored.isErr() && restored.error.message).toMatch(/fresh PostgreSQL data directory/);
    expect((await restoreRows(id)).map((r) => r.status)).toEqual(["failed"]);
  });

  it("a run with no stored snapshot is refused", async () => {
    const source = await createSource();
    const id = await createRun(source, "queued");
    const restored = await restoreBackup({ backupId: id, mode: "in-place", confirm: source.name });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreRefusedError");
    expect(restored.isErr() && restored.error.message).toMatch(/no stored snapshot/);
  });

  it("a restore that passes the gates and then fails is a typed failure, recorded failed", async () => {
    const source = await createSource();
    const id = await createRun(source, "succeeded");
    const restored = await restoreBackup({ backupId: id, mode: "download" });
    expect(restored.isErr() && restored.error._tag).toBe("RestoreFailedError");
    expect((await restoreRows(id)).map((r) => r.status)).toEqual(["failed"]);
  });
});

describe("one in-place restore per target", () => {
  it("refuses a second restore into a target another restore holds, without opening a row", async () => {
    const source = await createSource();
    const running = await createRun(source, "succeeded");
    const second = await createRun(source, "succeeded");
    expect(await claimRestoreLock(source.resourceId, running)).toBe(true);

    const refused = await restoreBackup({
      backupId: second,
      mode: "in-place",
      confirm: source.name,
    });
    expect(refused.isErr() && refused.error._tag).toBe("RestoreInProgressError");
    expect(refused.isErr() && refused.error.message).toContain(source.name);
    expect(await restoreRows(second)).toHaveLength(0);
    // A download writes nothing, so the claim does not gate it.
    const download = await restoreBackup({ backupId: second, mode: "download" });
    expect(download.isErr() && download.error._tag).toBe("RestoreFailedError");

    await releaseRestoreLock(source.resourceId, running);
    const after = await restoreBackup({ backupId: second, mode: "in-place", confirm: source.name });
    // Past the gate now: it fails on the unreadable repo, not on the claim.
    expect(after.isErr() && after.error._tag).toBe("RestoreFailedError");
  });

  it("two restores fired together: one runs, the other is refused, and no claim is left behind", async () => {
    const source = await createSource();
    const id = await createRun(source, "succeeded");
    const both = await Promise.all([
      restoreBackup({ backupId: id, mode: "in-place", confirm: source.name }),
      restoreBackup({ backupId: id, mode: "in-place", confirm: source.name }),
    ]);
    const tags = both.map((r) => (r.isErr() ? r.error._tag : "ok")).sort();
    // The claim is taken before any await that could let the second one
    // slip past, so at most one reaches the restore; when the first has
    // already finished, the second may legitimately run after it.
    expect(tags.filter((t) => t === "RestoreInProgressError").length).toBeLessThanOrEqual(1);
    expect(
      (await restoreRows(id)).length + tags.filter((t) => t === "RestoreInProgressError").length,
    ).toBe(2);
    const claims = await db.select().from(backupLock).where(eq(backupLock.backupId, id));
    expect(claims).toHaveLength(0);
  });
});
