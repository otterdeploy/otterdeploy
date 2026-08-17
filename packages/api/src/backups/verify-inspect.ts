/**
 * Sandbox inspection for restore-proving verification: wait for the throwaway
 * postgres to accept connections, stream the snapshot's dump into an
 * in-sandbox pg_restore, then collect the evidence bag (restored size, schema
 * and table counts, post-ANALYZE row estimates, size ratio). The verdict rule
 * and orchestration live in verify-restore.ts.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import type { ResolvedDestination } from "./backends";
import type { ExecutionContext } from "./db";

import { deriveRepoKey, toRusticRepo } from "./backends";
import { resolveSecret } from "./engine-helpers";
import { execCapture } from "./exec";
import { streamSnapshotIntoExec } from "./restore-stream";
import { RusticCli } from "./rustic";

/** Sandbox readiness: pg_isready poll cadence + ceiling. */
const READY_POLL_MS = 3_000;
const READY_TIMEOUT_MS = 120_000;

export type DatabaseContext = Extract<ExecutionContext, { kind: "database" | "stack" }>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One `psql -tA` scalar/text query against the sandbox, trimmed. Throws into
 *  the surrounding Result boundary on a non-zero exit. */
async function psql(docker: Docker, containerId: string, sql: string): Promise<string> {
  const result = await execCapture(
    docker,
    containerId,
    ["psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql],
    { allowNonZero: true },
  );
  if (result.exitCode !== 0) {
    throw new Error(`sandbox query failed (${result.exitCode}): ${result.stderr.slice(0, 500)}`);
  }
  return result.stdout.trim();
}

export interface Evidence {
  restoredSizeBytes: number;
  schemaCount: number;
  tableCount: number;
  rowCounts: Array<{ table: string; rows: number }>;
  dumpSizeBytes: number | null;
  sizeRatio: number | null;
  restoreExitCode: number;
  restoreStderrTail: string;
}

export function toChecks(e: Evidence): JsonObject {
  return {
    restoredSizeBytes: e.restoredSizeBytes,
    schemaCount: e.schemaCount,
    tableCount: e.tableCount,
    rowCounts: e.rowCounts.map((r) => ({ table: r.table, rows: r.rows })),
    dumpSizeBytes: e.dumpSizeBytes,
    sizeRatio: e.sizeRatio,
    restoreExitCode: e.restoreExitCode,
    restoreStderrTail: e.restoreStderrTail,
  };
}

/** Wait until the sandbox postgres accepts connections. A transport error
 *  during a poll counts as "not ready yet", not a hard failure. */
export async function waitSandboxReady(docker: Docker, containerId: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const probe = await Result.tryPromise({
      try: () =>
        execCapture(docker, containerId, ["pg_isready", "-U", "postgres"], {
          allowNonZero: true,
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (probe.isOk() && probe.value.exitCode === 0) return;
    if (Date.now() > deadline) {
      throw new Error("verification sandbox did not become ready within 120s");
    }
    await sleep(READY_POLL_MS);
  }
}

/** Restore the snapshot into the sandbox and gather the evidence bag. */
export async function restoreAndInspect(
  docker: Docker,
  sandboxId: string,
  ctx: DatabaseContext,
): Promise<Evidence> {
  const secret = await resolveSecret(ctx);
  const dest: ResolvedDestination = {
    type: ctx.destination.type,
    config: ctx.destination.config,
    secret,
  };
  const cli = new RusticCli(toRusticRepo(dest, deriveRepoKey(ctx)));
  const snapshotId = ctx.storagePath;
  if (!snapshotId) throw new Error("run recorded no snapshot");

  const restore = await streamSnapshotIntoExec({
    docker,
    containerId: sandboxId,
    cmd: ["pg_restore", "--no-owner", "--no-privileges", "-U", "postgres", "-d", "postgres"],
    env: [],
    cli,
    snapshotId,
    filenameInSnapshot: "dump",
  });

  // Evidence even when the restore client complained: the checks are what let
  // an operator see HOW broken (or fine) the result actually is.
  const restoredSizeBytes = Number.parseInt(
    await psql(docker, sandboxId, "SELECT pg_database_size(current_database())"),
    10,
  );
  const schemaCount = Number.parseInt(
    await psql(
      docker,
      sandboxId,
      "SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'",
    ),
    10,
  );
  const tableCount = Number.parseInt(
    await psql(
      docker,
      sandboxId,
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')",
    ),
    10,
  );
  // Best-effort: reltuples estimates improve after ANALYZE but stale stats
  // must not fail the verification.
  await Result.tryPromise({
    try: () => psql(docker, sandboxId, "ANALYZE"),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  const rowsRaw = await psql(
    docker,
    sandboxId,
    "SELECT n.nspname || '.' || c.relname || '|' || greatest(c.reltuples, 0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY c.reltuples DESC LIMIT 50",
  );
  const rowCounts = rowsRaw
    .split("\n")
    .filter((line) => line.includes("|"))
    .map((line) => {
      const sep = line.lastIndexOf("|");
      return { table: line.slice(0, sep), rows: Number.parseInt(line.slice(sep + 1), 10) || 0 };
    });

  const dumpSizeBytes = ctx.sourceSizeBytes;
  return {
    restoredSizeBytes,
    schemaCount,
    tableCount,
    rowCounts,
    dumpSizeBytes,
    sizeRatio: dumpSizeBytes && dumpSizeBytes > 0 ? restoredSizeBytes / dumpSizeBytes : null,
    restoreExitCode: restore.exitCode,
    restoreStderrTail: restore.stderr.slice(-2000),
  };
}
