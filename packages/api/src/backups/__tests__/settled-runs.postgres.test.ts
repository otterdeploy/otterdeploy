/**
 * Backup runs, verifications and restores are settled once.
 *
 * Every write on these rows only moves a row that is still where its writer
 * expects it, and reports whether it did. During a rolling update the new
 * process's boot reconcile fails the old process's in-flight work; when the
 * old process then finishes, its late success (or failure) is refused and the
 * reconciled outcome stands. The boot reconcile also settles interrupted
 * restores and verifications, and the badge of the run a verification was
 * proving.
 *
 * Real Postgres, real row helpers (backups/db.ts, verify-db.ts, restore-db.ts).
 */
import type { BackupDestinationId, BackupId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backup, backupRestore, backupVerification } from "@otterdeploy/db/schema";
import { Temporal } from "@otterdeploy/shared/temporal";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization, uniq } from "../../__tests__/postgres-seed";
import { createDestinationRecord } from "../../routers/backups/destination-queries";
import {
  createBackupRun,
  markBackupFailed,
  markBackupRunning,
  markBackupSucceeded,
  reconcileInterruptedBackups,
} from "../db";
import { createRestoreRun, finishRestoreRun } from "../restore-db";
import {
  createVerificationRun,
  finishVerification,
  markBackupVerifying,
  markVerificationRunning,
} from "../verify-db";

let organizationId: OrganizationId;
let destinationId: BackupDestinationId;

beforeAll(async () => {
  organizationId = await seedOrganization("backup-runs");
  const destination = await createDestinationRecord({
    organizationId,
    name: `local-${uniq()}`,
    type: "local",
    config: { path: `/nonexistent/otterdeploy-backups/${uniq()}` },
    encryptedSecret: null,
    usedForBackups: true,
  });
  destinationId = destination.id;
});

const SNAPSHOT = {
  checksum: null,
  compressedSizeBytes: 1024,
  sourceSizeBytes: 4096,
  durationMs: 10,
  method: "volume-tar",
};

function createRun(): Promise<BackupId> {
  return createBackupRun({
    organizationId,
    source: { kind: "volume", volumeName: `vol-${uniq()}` },
    destinationId,
  });
}

async function createSucceededRun(): Promise<BackupId> {
  const id = await createRun();
  await markBackupRunning(id);
  await markBackupSucceeded(id, { ...SNAPSHOT, storagePath: `snap-${uniq()}` });
  return id;
}

/** "The server restarted now": the boot reconcile, with a boot instant after
 *  every row this file wrote. A Date only at the drizzle timestamp seam. */
function bootReconcile() {
  return reconcileInterruptedBackups(
    new Date(Temporal.Now.instant().add({ minutes: 1 }).epochMilliseconds),
  );
}

async function readRun(id: BackupId) {
  const [row] = await db
    .select({ status: backup.status, verifiedStatus: backup.verifiedStatus })
    .from(backup)
    .where(eq(backup.id, id));
  if (!row) throw new Error(`backup ${id} vanished`);
  return row;
}

describe("backup run writes", () => {
  it("a run the boot reconcile failed stays failed when its dump finishes late", async () => {
    const id = await createRun();
    expect(await markBackupRunning(id)).toBe(true);
    const reconciled = await bootReconcile();
    expect(reconciled.map((row) => row.id)).toContain(id);

    expect(await markBackupSucceeded(id, { ...SNAPSHOT, storagePath: `snap-${uniq()}` })).toBe(
      false,
    );
    expect(await markBackupFailed(id, "late failure")).toBe(false);
    const [row] = await db
      .select({ status: backup.status, errorMessage: backup.errorMessage })
      .from(backup)
      .where(eq(backup.id, id));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toContain("interrupted");
  });

  it("a settled run is not started again", async () => {
    const id = await createRun();
    await markBackupFailed(id, "refused");
    expect(await markBackupRunning(id)).toBe(false);
    expect((await readRun(id)).status).toBe("failed");
  });

  it("a succeeded run is never turned into a failure after the fact", async () => {
    const id = await createSucceededRun();
    expect(await markBackupFailed(id, "late failure")).toBe(false);
    expect((await readRun(id)).status).toBe("succeeded");
  });
});

describe("verification writes", () => {
  it("a verification the boot reconcile failed keeps its verdict, and so does the run's badge", async () => {
    const backupId = await createSucceededRun();
    const id = await createVerificationRun({ organizationId, backupId, trigger: "manual" });
    expect(await markVerificationRunning(id)).toBe(true);
    await markBackupVerifying(backupId);

    await bootReconcile();
    const [verification] = await db
      .select({ status: backupVerification.status })
      .from(backupVerification)
      .where(eq(backupVerification.id, id));
    expect(verification?.status).toBe("failed");
    expect((await readRun(backupId)).verifiedStatus).toBe("failed");

    const late = await finishVerification({
      id,
      backupId,
      passed: true,
      checks: null,
      failMessage: null,
      durationMs: 5,
    });
    expect(late).toBe(false);
    expect((await readRun(backupId)).verifiedStatus).toBe("failed");
    expect(await markVerificationRunning(id)).toBe(false);
  });

  it("an in-flight verification settles once", async () => {
    const backupId = await createSucceededRun();
    const id = await createVerificationRun({ organizationId, backupId, trigger: "manual" });
    await markVerificationRunning(id);
    await markBackupVerifying(backupId);
    const verdict = { id, backupId, checks: null, failMessage: null, durationMs: 5 };
    expect(await finishVerification({ ...verdict, passed: true })).toBe(true);
    expect(await finishVerification({ ...verdict, passed: false })).toBe(false);
    expect((await readRun(backupId)).verifiedStatus).toBe("passed");
  });
});

describe("restore writes", () => {
  it("a restore the boot reconcile failed stays failed when it finishes late", async () => {
    const backupId = await createSucceededRun();
    const id = await createRestoreRun({
      organizationId,
      backupId,
      mode: "download",
      targetResourceId: null,
    });

    await bootReconcile();
    expect(await finishRestoreRun({ id, status: "succeeded", durationMs: 5 })).toBe(false);
    const [row] = await db
      .select({ status: backupRestore.status, errorMessage: backupRestore.errorMessage })
      .from(backupRestore)
      .where(eq(backupRestore.id, id));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toContain("interrupted");
  });

  it("an in-flight restore settles once", async () => {
    const backupId = await createSucceededRun();
    const id = await createRestoreRun({
      organizationId,
      backupId,
      mode: "download",
      targetResourceId: null,
    });
    expect(await finishRestoreRun({ id, status: "succeeded", durationMs: 5 })).toBe(true);
    expect(
      await finishRestoreRun({ id, status: "failed", errorMessage: "late", durationMs: 5 }),
    ).toBe(false);
  });
});
