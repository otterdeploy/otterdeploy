/**
 * Restore-proving verification: prove a backup RESTORES, not merely that the
 * repo is intact (that cheaper structural check remains verifyBackup in
 * restore.ts). Modeled on databasus's verification agent:
 *
 *   1. spin up a throwaway container of the SAME image as the source database
 *      (so the restore client always matches the server version),
 *   2. stream the snapshot's dump into an in-sandbox pg_restore,
 *   3. collect evidence: restored size, schema/table counts, per-table row
 *      estimates (post-ANALYZE), size ratio against the recorded dump size,
 *   4. verdict: tables exist AND the restored database is not implausibly
 *      small relative to the dump (guards against pg_restore "succeeding"
 *      into a near-empty database).
 *
 * v1 is postgres-only (like databasus's agent). Volume tars and other engines
 * report unsupported rather than a fake green. The sandbox never joins any
 * network and is force-removed on every path. Failure handling is
 * better-result end to end. The sandbox mechanics live in verify-inspect.ts.
 */
import type { BackupId } from "@otterdeploy/shared/id";

import { Docker } from "@otterdeploy/docker";
import { Result, TaggedError } from "better-result";
import { randomBytes } from "node:crypto";

import type { VerificationTrigger } from "./verify-db";

import { emitPlatformEvent } from "../notifications/emit";
import { appendBackupLog, getExecutionContext } from "./db";
import { findResourceContainerId } from "./exec";
import {
  type DatabaseContext,
  type Evidence,
  restoreAndInspect,
  toChecks,
  waitSandboxReady,
} from "./verify-inspect";
import {
  createVerificationRun,
  finishVerification,
  markBackupVerifying,
  markVerificationRunning,
} from "./verify-db";

/** Reject a restore whose resulting database is under this fraction of the
 *  dump's byte size (databasus uses the same 20% floor against source size). */
const MIN_SIZE_RATIO = 0.2;

/** The slice of a run's context the support gate reads. `ExecutionContext`
 *  is a structural superset; tests build this narrow shape directly. */
export interface VerificationCandidate {
  kind: "database" | "stack" | "volume";
  engine?: string;
  storagePath?: string | null;
  approach?: "logical" | "physical";
}

/** The one gate callers can pre-check: which runs verification can prove. */
export function verificationSupport(ctx: VerificationCandidate): { ok: boolean; reason?: string } {
  if (ctx.kind === "volume") {
    return {
      ok: false,
      reason: "verification restores database dumps; volume tars are not covered yet",
    };
  }
  if (ctx.approach === "physical") {
    return {
      ok: false,
      reason:
        "physical base backups verify by extraction into a fresh data directory, not pg_restore; not covered yet",
    };
  }
  if (ctx.engine !== "postgres") {
    return {
      ok: false,
      reason: `verification is postgres-only for now (run engine: ${ctx.engine ?? "unknown"})`,
    };
  }
  if (!ctx.storagePath) return { ok: false, reason: "run recorded no snapshot (did it succeed?)" };
  return { ok: true };
}

/** Pure verdict rule, split out for unit tests. */
export function verificationVerdict(e: {
  restoreExitCode: number;
  tableCount: number;
  sizeRatio: number | null;
}): { passed: boolean; reason: string | null } {
  if (e.restoreExitCode !== 0) {
    return { passed: false, reason: `pg_restore exited ${e.restoreExitCode}` };
  }
  if (e.tableCount < 1) {
    return { passed: false, reason: "restored database contains no tables" };
  }
  if (e.sizeRatio != null && e.sizeRatio < MIN_SIZE_RATIO) {
    return {
      passed: false,
      reason: `restored database is implausibly small (${Math.round(e.sizeRatio * 100)}% of the dump)`,
    };
  }
  return { passed: true, reason: null };
}

/** A verification request against a run it can't prove (volume tar, non-pg
 *  engine, never-succeeded run). */
export class VerificationUnsupportedError extends TaggedError("VerificationUnsupportedError")<{
  message: string;
  backupId: BackupId;
}>() {
  constructor(args: { backupId: BackupId; reason: string }) {
    super({ backupId: args.backupId, message: args.reason });
  }
}

export class BackupContextMissingError extends TaggedError("BackupContextMissingError")<{
  message: string;
  backupId: BackupId;
}>() {
  constructor(args: { backupId: BackupId }) {
    super({ backupId: args.backupId, message: `backup ${args.backupId} has no execution context` });
  }
}

/**
 * Gate + start a verification for a succeeded backup. On ok, the row exists in
 * `queued` and the sandbox flow runs DETACHED (it can take minutes); poll the
 * verification list for the outcome. Unsupported runs are a typed error, not a
 * fake red row.
 */
export async function requestBackupVerification(
  backupId: BackupId,
  trigger: VerificationTrigger,
): Promise<
  Result<
    Awaited<ReturnType<typeof createVerificationRun>>,
    VerificationUnsupportedError | BackupContextMissingError
  >
> {
  const ctx = await getExecutionContext(backupId);
  if (!ctx) return Result.err(new BackupContextMissingError({ backupId }));
  const support = verificationSupport(ctx);
  if (!support.ok || ctx.kind === "volume") {
    return Result.err(
      new VerificationUnsupportedError({
        backupId,
        reason: support.reason ?? "verification unsupported for this run",
      }),
    );
  }
  const verificationId = await createVerificationRun({
    organizationId: ctx.organizationId,
    backupId,
    trigger,
  });
  void executeVerification(verificationId, backupId, ctx);
  return Result.ok(verificationId);
}

/** The full sandbox flow: resolve image → create + start → ready → restore →
 *  inspect. Throws into the caller's Result boundary; records the sandbox id
 *  on `sandboxRef` the moment it exists so cleanup can always find it. */
async function verifyInSandbox(
  docker: Docker,
  ctx: DatabaseContext,
  sandboxRef: { id: string | null },
  log: (line: string) => Promise<void>,
): Promise<Evidence> {
  // Same image as the source container → restore client matches the server
  // version by construction (no vendored client-version matrix needed).
  const sourceContainerId = await findResourceContainerId(docker, ctx.resourceId);
  if (!sourceContainerId) {
    throw new Error("source database container is not running (needed to resolve its image)");
  }
  const inspected = await docker.containers.inspect(sourceContainerId);
  if (inspected.isErr()) throw inspected.error;
  const image = inspected.value.Config.Image;
  if (!image) throw new Error("could not resolve the source container's image");

  const created = await docker.containers.create({
    Image: image,
    Env: [`POSTGRES_PASSWORD=${randomBytes(16).toString("hex")}`],
    Labels: { "otterdeploy.backup.verify": ctx.backupId },
    HostConfig: { NetworkMode: "none" },
  });
  if (created.isErr()) throw created.error;
  sandboxRef.id = created.value.id;
  const started = await created.value.start();
  if (started.isErr()) throw started.error;

  await waitSandboxReady(docker, created.value.id);
  await log(`Sandbox ready (${image}); restoring snapshot`);
  return restoreAndInspect(docker, created.value.id, ctx);
}

/** The detached sandbox flow. Always resolves; the verdict lands on the
 *  verification row + run badge, and failures emit `backup.verify-failed`. */
async function executeVerification(
  verificationId: Awaited<ReturnType<typeof createVerificationRun>>,
  backupId: BackupId,
  ctx: DatabaseContext,
): Promise<void> {
  const log = (line: string) => appendBackupLog(backupId, "system", line);
  const startedAt = Date.now();
  await markVerificationRunning(verificationId);
  await markBackupVerifying(backupId);

  const docker = Docker.fromEnv();
  const sandboxRef: { id: string | null } = { id: null };
  await log("Verification started: sandbox restore of the snapshot");

  const outcome = await Result.tryPromise({
    try: () => verifyInSandbox(docker, ctx, sandboxRef, log),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

  // Cleanup before verdict bookkeeping so a slow DB write can't strand the
  // sandbox. `remove` returns a Result; a cleanup failure is ignored by design.
  if (sandboxRef.id) {
    await docker.containers.getContainer(sandboxRef.id).remove({ force: true });
  }
  docker.destroy();

  const durationMs = Date.now() - startedAt;
  if (outcome.isOk()) {
    const evidence = outcome.value;
    const verdict = verificationVerdict(evidence);
    await finishVerification({
      id: verificationId,
      backupId,
      passed: verdict.passed,
      checks: toChecks(evidence),
      failMessage: verdict.reason,
      durationMs,
    });
    await log(
      verdict.passed
        ? `Verification passed: ${evidence.tableCount} tables, ${evidence.restoredSizeBytes} B restored`
        : `Verification FAILED: ${verdict.reason ?? "unknown"}`,
    );
    if (!verdict.passed) await emitVerifyFailed(ctx, backupId, verdict.reason);
    return;
  }

  const message = outcome.error.message;
  await finishVerification({
    id: verificationId,
    backupId,
    passed: false,
    checks: null,
    failMessage: message,
    durationMs,
  });
  await log(`Verification errored: ${message}`);
  await emitVerifyFailed(ctx, backupId, message);
}

async function emitVerifyFailed(
  ctx: DatabaseContext,
  backupId: BackupId,
  reason: string | null,
): Promise<void> {
  await emitPlatformEvent({
    organizationId: ctx.organizationId,
    eventId: "backup.verify-failed",
    title: "Backup verification failed",
    message: `${ctx.resourceName} (${ctx.projectSlug}): ${reason ?? "verification failed"}`,
    data: { backupId, resource: ctx.resourceName, project: ctx.projectSlug },
  });
}

