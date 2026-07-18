/**
 * Volume backup/restore for the backup engine. A named Docker volume has no
 * logical-dump client, so the archive is a tar of its contents produced by a
 * disposable helper container with the volume mounted read-only at /v:
 *
 *   backup : run alpine `tar cf - -C /v .` (ro mount) → stdout buffer,
 *            then the caller reuses the exact gzip/encrypt/checksum/storage
 *            plumbing the database dumps go through.
 *   restore: refuse while ANY container (any state) still mounts the volume
 *            (same conservatism as the volumes router's remove guard), clear
 *            the volume, then extract the tar via the daemon's archive API
 *            (PUT /containers/{id}/archive on a created-but-never-started
 *            helper) — no stdin-attach plumbing needed.
 *
 * The pure decision/arg builders live at the top so they're unit-testable
 * without a daemon (see __tests__/volume.test.ts).
 */
import type { Docker, Mount } from "@otterdeploy/docker";

import { DockerNotFoundError, followProgress } from "@otterdeploy/docker";
import { PassThrough, Readable, Writable } from "node:stream";

/** Helper image for tar/clear runs — small, ships GNU-compatible busybox tar. */
export const VOLUME_HELPER_IMAGE = "alpine:3.20";

/** Where the volume is mounted inside helper containers. */
export const VOLUME_MOUNT_TARGET = "/v";

// ─── Pure helpers (unit-tested) ────────────────────────────────────────────

/** tar-create command: stream the volume's contents (incl. dotfiles) to stdout. */
export function volumeTarCreateArgs(): string[] {
  return ["tar", "cf", "-", "-C", VOLUME_MOUNT_TARGET, "."];
}

/** Empty the volume before extraction so a restore replaces, not overlays. */
export function volumeClearArgs(): string[] {
  return ["find", VOLUME_MOUNT_TARGET, "-mindepth", "1", "-delete"];
}

/** Mount spec claiming the volume at /v in a helper container. */
export function volumeMountSpec(volumeName: string, opts: { readOnly: boolean }): Mount {
  return {
    Type: "volume",
    Source: volumeName,
    Target: VOLUME_MOUNT_TARGET,
    ReadOnly: opts.readOnly,
  };
}

/** Storage-key scope segment for a volume archive (databases use resourceId). */
export function volumeArchiveScope(volumeName: string): string {
  return `volume-${volumeName}`;
}

/**
 * In-use guard for restore: extracting under a container that mounts the
 * volume (even a stopped one that may restart mid-extract) risks a corrupt
 * half-state. Returns the human refusal reason, or null when safe.
 */
export function volumeRestoreBlockReason(containerNames: string[]): string | null {
  if (containerNames.length === 0) return null;
  const shown = containerNames.slice(0, 3).join(", ");
  const more = containerNames.length > 3 ? ` and ${containerNames.length - 3} more` : "";
  return `volume is mounted by ${shown}${more} — stop and remove those containers before restoring`;
}

// ─── Daemon operations ─────────────────────────────────────────────────────

/** Buffer-collecting Writable with a completion promise for attach streams. */
function bufferSink(): { sink: Writable; done: Promise<Buffer> } {
  const chunks: Buffer[] = [];
  let resolve!: (b: Buffer) => void;
  let reject!: (e: Error) => void;
  const done = new Promise<Buffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
    final(cb) {
      resolve(Buffer.concat(chunks));
      cb();
    },
  });
  sink.on("error", reject);
  return { sink, done };
}

/** Pull the helper image (no-op layers when cached). */
async function pullHelperImage(docker: Docker): Promise<void> {
  const stream = await docker.pull(VOLUME_HELPER_IMAGE);
  if (stream.isErr()) throw stream.error;
  await new Promise<void>((resolve, reject) => {
    followProgress(stream.value, (err) => (err ? reject(err) : resolve()));
  });
}

/** `docker.run` with a pull-and-retry when the helper image is absent locally. */
async function runHelper(
  docker: Docker,
  cmd: string[],
  mount: Mount,
  output?: [Writable, Writable],
): Promise<{ statusCode: number }> {
  const options = { HostConfig: { Mounts: [mount] }, autoRemove: true };
  let result = await docker.run(VOLUME_HELPER_IMAGE, cmd, output, options);
  if (result.isErr() && result.error instanceof DockerNotFoundError) {
    await pullHelperImage(docker);
    result = await docker.run(VOLUME_HELPER_IMAGE, cmd, output, options);
  }
  if (result.isErr()) throw result.error;
  return { statusCode: result.value.output.StatusCode };
}

/** Assert the named volume exists on the daemon (clear error when it doesn't). */
export async function assertVolumeExists(docker: Docker, volumeName: string): Promise<void> {
  const inspected = await docker.volumes.inspect(volumeName);
  if (inspected.isErr()) {
    if (inspected.error instanceof DockerNotFoundError) {
      throw new Error(`volume "${volumeName}" does not exist on the daemon`);
    }
    throw inspected.error;
  }
}

/** A streaming volume dump (mirrors exec.ts `DumpStream`): `stream` is the tar
 *  bytes flowing out of the helper container, `stderr()`/`exitCode` settle once
 *  the helper exits. The consumer (rustic) MUST drain `stream` — the helper is
 *  only reaped after its stdout is fully piped, so both promises hang otherwise. */
export interface VolumeDumpStream {
  stream: Readable;
  stderr: () => Promise<string>;
  exitCode: Promise<number>;
}

/**
 * Stream a tar of the volume's contents out of a read-only helper container.
 * A live writer can still produce a crash-consistent archive — same guarantee
 * a `tar` of a running system gives — so no in-use guard on the backup side.
 *
 * Returns immediately with a `stream` that receives the tar bytes as they flow
 * (piped `end:true` inside `docker.run`); rustic consumes it as backup stdin —
 * nothing is buffered in RAM. `runHelper` waits for the helper to exit + be
 * auto-removed in the background, exposed via `exitCode`.
 */
export function dumpVolume(docker: Docker, volumeName: string): VolumeDumpStream {
  const stream = new PassThrough();
  const err = bufferSink();
  // NOTE: pulls can't race the run — runHelper pulls only after a failed run,
  // and only attaches (pipes to `stream`) on the attempt that actually starts.
  const run = runHelper(
    docker,
    volumeTarCreateArgs(),
    volumeMountSpec(volumeName, { readOnly: true }),
    [stream, err.sink],
  );
  // On a run/pull failure the helper never pipes anything: surface the cause on
  // `stream` so the rustic pipe rejects (rather than hanging on an empty
  // stdin), and end the stderr sink so `stderr()` still resolves.
  run.catch((cause) => {
    stream.destroy(cause instanceof Error ? cause : new Error(String(cause)));
    err.sink.end();
  });
  return {
    stream,
    stderr: () => err.done.then((b) => b.toString("utf8")),
    // Non-rejecting: a failed run resolves non-zero (the real cause rides
    // `stream`), so awaiting `exitCode` never produces an unhandled rejection.
    exitCode: run.then(
      (r) => r.statusCode,
      () => 1,
    ),
  };
}

/** Names of ALL containers (any state) whose mounts reference the volume. */
export async function listVolumeMounters(docker: Docker, volumeName: string): Promise<string[]> {
  const result = await docker.containers.list({
    all: true,
    filters: { volume: [volumeName] },
  });
  if (result.isErr()) throw result.error;
  return result.value.map((c) => (c.Names?.[0] ?? c.Id).replace(/^\//, ""));
}

/**
 * Replace the volume's contents with a plain tar archive: clear, then extract
 * through the daemon's archive endpoint on a created (never started) helper
 * container. Caller MUST have run the in-use guard first.
 */
export async function restoreVolumeFromTar(
  docker: Docker,
  volumeName: string,
  tar: Buffer,
): Promise<void> {
  const clear = await runHelper(
    docker,
    volumeClearArgs(),
    volumeMountSpec(volumeName, { readOnly: false }),
  );
  if (clear.statusCode !== 0) {
    throw new Error(`volume clear exited ${clear.statusCode} — restore aborted before extraction`);
  }

  const created = await docker.containers.create({
    Image: VOLUME_HELPER_IMAGE,
    Cmd: ["true"],
    HostConfig: { Mounts: [volumeMountSpec(volumeName, { readOnly: false })] },
  });
  if (created.isErr()) throw created.error;
  const helper = created.value;
  try {
    const put = await helper.putArchive({ path: VOLUME_MOUNT_TARGET }, Readable.from(tar));
    if (put.isErr()) throw put.error;
  } finally {
    await helper.remove({ force: true });
  }
}
