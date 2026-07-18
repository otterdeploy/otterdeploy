/**
 * Restore + verify for rustic snapshots. `restoreBackup` hands back the snapshot
 * file bytes (download) or streams them into the live database/volume (in-place,
 * typed-name-confirmed); `verifyBackup` runs a structural repo `check` and
 * confirms the recorded snapshot still resolves. rustic owns dedup + zstd +
 * repo-key encryption, so there is no decrypt/gunzip/checksum plumbing here — a
 * run's `storagePath` is the snapshot id, which is all we need to address it.
 * Split out of engine.ts, which keeps the backup write path (executeBackup).
 */
import type { Duplex, Readable, Writable } from "node:stream";

import { Docker, demuxStream } from "@otterdeploy/docker";
import { Writable as NodeWritable } from "node:stream";

import type { ResolvedDestination } from "./backends";

import { buildContainerName } from "../routers/project/views";
import { deriveRepoId, toRusticRepo } from "./backends";
import { type ExecutionContext, getExecutionContext } from "./db";
import { resolveSecret } from "./engine-helpers";
import { findResourceContainerId } from "./exec";
import { RusticCli } from "./rustic";
import {
  assertVolumeExists,
  listVolumeMounters,
  restoreVolumeFromTar,
  volumeRestoreBlockReason,
} from "./volume";

/** Open the run's rustic repo: resolve backend creds, derive the (resource ×
 *  destination) repo id + its password, and build a driver. */
async function openRepo(ctx: ExecutionContext): Promise<RusticCli> {
  const secret = await resolveSecret(ctx);
  const dest: ResolvedDestination = {
    type: ctx.destination.type,
    config: ctx.destination.config,
    secret,
  };
  return new RusticCli(toRusticRepo(dest, deriveRepoId(ctx)));
}

/** Collect a readable stream fully into one Buffer. */
function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** A buffer-collecting Writable + a promise that resolves with the bytes once
 *  the writer finishes — the sink we hand `dumpToStream` when a caller needs the
 *  snapshot file materialised (download bytes, or the volume tar to re-extract). */
function bufferSink(): { sink: Writable; done: Promise<Buffer> } {
  const chunks: Buffer[] = [];
  let resolveDone!: (b: Buffer) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<Buffer>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  const sink = new NodeWritable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
    final(cb) {
      resolveDone(Buffer.concat(chunks));
      cb();
    },
  });
  sink.on("error", rejectDone);
  return { sink, done };
}

export type RestoreMode = "download" | "in-place";

type VolumeContext = Extract<ExecutionContext, { kind: "volume" }>;
type DatabaseContext = Extract<ExecutionContext, { kind: "database" }>;

/** In-place restore of a named volume: refuse while any container mounts it,
 *  then reload the snapshot's tar via the backup path's helper mechanics. */
async function restoreVolumeInPlace(
  docker: Docker,
  ctx: VolumeContext,
  cli: RusticCli,
  snapshotId: string,
): Promise<{ ok: true }> {
  // Guard: extracting under a container that mounts the volume — even a stopped
  // one that could restart mid-extract — risks a corrupt half-state.
  const mounters = await listVolumeMounters(docker, ctx.volumeName);
  const blocked = volumeRestoreBlockReason(mounters);
  if (blocked) throw new Error(blocked);
  await assertVolumeExists(docker, ctx.volumeName);
  // Stream the tar out of the snapshot, then load it back through the same
  // helper-container mechanics the backup path uses (clear + putArchive).
  const { sink, done } = bufferSink();
  await cli.dumpToStream({ snapshotId, filenameInSnapshot: "volume.tar", out: sink });
  const tar = await done;
  await restoreVolumeFromTar(docker, ctx.volumeName, tar);
  return { ok: true };
}

/** In-place restore of a Postgres DB: stream the snapshot's dump into an
 *  in-container pg_restore over a hijacked exec duplex (drained to avoid
 *  deadlock); fail the run on a non-zero pg_restore exit. */
async function restorePostgresInPlace(
  docker: Docker,
  ctx: DatabaseContext,
  cli: RusticCli,
  snapshotId: string,
): Promise<{ ok: true }> {
  const serviceName = buildContainerName({
    engine: ctx.engine,
    projectSlug: ctx.projectSlug,
    resourceName: ctx.resourceName,
  });
  const containerId = await findResourceContainerId(docker, ctx.resourceId);
  if (!containerId) throw new Error(`No running container for ${serviceName}`);

  if (ctx.engine !== "postgres") {
    throw new Error(`in-place restore for ${ctx.engine} is not implemented`);
  }

  // Stream the custom-format dump straight from the snapshot into an in-container
  // pg_restore: rustic writes to pg_restore's stdin over the exec's hijacked
  // duplex, and we demux + capture its stderr. pg_restore exits non-zero on a
  // genuinely failed restore, so we surface stderr and fail the run — a silent
  // `{ ok: true }` on a half-restored DB would mislead the caller.
  const container = docker.containers.getContainer(containerId);
  const execResult = await container.exec({
    Cmd: [
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "-U",
      ctx.username,
      "-d",
      ctx.databaseName,
    ],
    Env: [`PGPASSWORD=${ctx.password}`],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  if (execResult.isErr()) throw execResult.error;
  const exec = execResult.value;

  const startResult = await exec.start({ Detach: false, Tty: false, stdin: true });
  if (startResult.isErr()) throw startResult.error;
  const duplex = startResult.value as Duplex;

  // Drain stdout + capture stderr BEFORE piping the dump in: demux back-pressures
  // behind unread output, so an unconsumed pg_restore stream would deadlock the
  // dump we're feeding into stdin.
  const { stdout, stderr } = demuxStream(duplex);
  const stdoutDone = collect(stdout);
  const stderrDone = collect(stderr);

  // rustic's stdout is piped into the duplex (pg_restore stdin); ending it on
  // completion half-closes stdin (FIN, read side stays open) so pg_restore sees
  // EOF, finishes, and its exit code becomes observable via inspect().
  await cli.dumpToStream({ snapshotId, filenameInSnapshot: "dump", out: duplex });
  await stdoutDone;
  const stderrText = (await stderrDone).toString("utf8");

  const inspect = await exec.inspect();
  const exitCode = inspect.isOk() ? (inspect.value.ExitCode ?? 0) : 0;
  if (exitCode !== 0) {
    throw new Error(`pg_restore failed (exit ${exitCode}): ${stderrText.slice(0, 2000)}`);
  }
  return { ok: true };
}

/**
 * Restore a succeeded backup. `download` streams the snapshot's file back out
 * (`dump`) and returns its bytes for the caller to hand to the user. `in-place`
 * streams it into the live database (pg only) or, for volume runs, replaces the
 * volume's contents — refused while any container still mounts it.
 */
export async function restoreBackup(input: {
  backupId: string;
  mode: RestoreMode;
  /** Typed-name confirmation, required for the destructive in-place mode.
   *  Must equal the source's name (resource name/id, or the volume name). The
   *  UI collects it; we re-check here so a direct API call can't skip the gate. */
  confirm?: string;
}): Promise<{ ok: true; bytes?: Buffer; filename?: string }> {
  const ctx = await getExecutionContext(input.backupId as ExecutionContext["backupId"]);
  if (!ctx) throw new Error("backup execution context not found");

  // In-place overwrites live data — require the typed-name confirmation
  // server-side, not just in the dialog.
  if (input.mode === "in-place") {
    const expected = ctx.kind === "volume" ? [ctx.volumeName] : [ctx.resourceName, ctx.resourceId];
    if (!input.confirm || !expected.includes(input.confirm)) {
      throw new Error(
        `restore confirmation required: type "${expected[0]}" to confirm in-place restore`,
      );
    }
  }

  // `storagePath` holds the rustic snapshot id (set when the run succeeded).
  const snapshotId = ctx.storagePath;
  if (!snapshotId) throw new Error("backup has no stored snapshot (did the run succeed?)");

  const cli = await openRepo(ctx);
  const filenameInSnapshot = ctx.kind === "volume" ? "volume.tar" : "dump";

  if (input.mode === "download") {
    const { sink, done } = bufferSink();
    await cli.dumpToStream({ snapshotId, filenameInSnapshot, out: sink });
    const bytes = await done;
    const filename = ctx.kind === "volume" ? `${ctx.backupId}.tar` : `${ctx.backupId}.dump`;
    return { ok: true, bytes, filename };
  }

  const docker = Docker.fromEnv();
  try {
    return ctx.kind === "volume"
      ? await restoreVolumeInPlace(docker, ctx, cli, snapshotId)
      : await restorePostgresInPlace(docker, ctx, cli, snapshotId);
  } finally {
    docker.destroy();
  }
}

export interface VerifyResult {
  /** False when the repo could not be reached / checked. */
  ok: boolean;
  /** Repo `check` passed AND the recorded snapshot still resolves; null when
   *  verification couldn't run. */
  match: boolean | null;
  /** The recorded snapshot id (rustic addresses integrity by id, not a blob hash). */
  storedChecksum: string | null;
  /** Always null — rustic owns integrity structurally; there is no blob hash to recompute. */
  computedChecksum: string | null;
  /** Not exposed by the rustic check/snapshotExists surface — always null here. */
  archiveSizeBytes: number | null;
  /** Why verification couldn't run (no snapshot recorded, repo unreachable). */
  reason: string | null;
}

/**
 * Integrity check for a stored snapshot: run rustic's structural `check` over
 * the whole repo, then confirm the run's recorded snapshot id still resolves.
 * This proves the destination still holds an intact repo containing the exact
 * snapshot the run recorded — no download/decrypt/restore needed.
 */
export async function verifyBackup(backupId: string): Promise<VerifyResult> {
  const ctx = await getExecutionContext(backupId as ExecutionContext["backupId"]);
  if (!ctx) {
    return {
      ok: false,
      match: null,
      storedChecksum: null,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: "backup execution context not found",
    };
  }

  const snapshotId = ctx.storagePath;
  if (!snapshotId) {
    return {
      ok: false,
      match: null,
      storedChecksum: null,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: "run recorded no snapshot (did it succeed?)",
    };
  }

  try {
    const cli = await openRepo(ctx);
    // `check` throws on structural repo/pack corruption; `snapshotExists`
    // confirms the specific snapshot the row points at is still present.
    await cli.check();
    const exists = await cli.snapshotExists(snapshotId);
    return {
      ok: true,
      match: exists,
      storedChecksum: snapshotId,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: exists ? null : "recorded snapshot no longer resolves in the repo",
    };
  } catch (cause) {
    return {
      ok: false,
      match: null,
      storedChecksum: snapshotId,
      computedChecksum: null,
      archiveSizeBytes: null,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
