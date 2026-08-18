/**
 * Read-only volume file explorer: browse a named volume's contents without
 * SSH. Mirrors the backup engine's helper-container trick (backups/volume.ts):
 * a disposable alpine container mounts the volume read-only at /v, runs one
 * BusyBox command, exits, and is auto-removed. On top of that:
 *
 *   listVolumeDir : `find <dir> -maxdepth 1 -exec stat -c <fmt> {} +`: one
 *                   run yields the directory itself (depth 0, proves it IS a
 *                   directory) plus its direct children.
 *   readVolumeFile: `stat` for size/type, then `head -c 256K` for the bytes.
 *                   NUL in the captured bytes ⇒ reported binary, no content.
 *
 * Safety model: the path is user input:
 *   - validated/normalized by `resolveVolumeExplorePath` (explore-parse.ts)
 *     BEFORE any daemon call: `..` segments, `~` expansion candidates, and
 *     NUL are refused;
 *   - every command is an argv array handed to the daemon: there is no
 *     shell anywhere, so no quoting/injection surface;
 *   - the mount is ReadOnly and the helper gets NetworkMode "none";
 *   - the volume's existence is checked first, because a run would otherwise
 *     auto-CREATE a missing named volume as a side effect of mounting it;
 *   - reads refuse non-regular files, so a symlink planted in the volume
 *     can't be dereferenced into the helper's own filesystem.
 */
import type { Mount } from "@otterdeploy/docker";

import { Docker, DockerNotFoundError, followProgress } from "@otterdeploy/docker";
import { Writable } from "node:stream";

import type { VolumeDirEntry } from "./explore-parse";

import { volumeMountSpec } from "../../backups/volume";
import { parseVolumeDirListing, resolveVolumeExplorePath, STAT_LIST_FORMAT } from "./explore-parse";

const docker = Docker.fromEnv();

/** Same helper image the volume backup path uses: small, ships BusyBox. */
const EXPLORE_HELPER_IMAGE = "alpine:3.20";

/** Hard cap on file-view bytes (256 KiB): larger files render truncated. */
export const VOLUME_FILE_READ_CAP = 262144;

// ─── Helper-container plumbing ─────────────────────────────────────────────

/** Buffer-collecting Writable with a completion promise (as backups/volume.ts,
 *  whose sink isn't exported). */
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

interface HelperCapture {
  statusCode: number;
  stdout: Buffer;
  stderr: string;
}

/**
 * Run one command in the read-only helper and capture its output, with the
 * same pull-and-retry the backup helper uses when the image is absent
 * locally. No network inside the container: nothing here needs one.
 */
async function runExploreHelper(
  cmd: string[],
  mount: Mount,
): Promise<{ ok: true; capture: HelperCapture } | { ok: false; reason: string }> {
  const out = bufferSink();
  const err = bufferSink();
  const options = {
    HostConfig: { Mounts: [mount], NetworkMode: "none" },
    autoRemove: true,
  };
  let result = await docker.run(EXPLORE_HELPER_IMAGE, cmd, [out.sink, err.sink], options);
  if (result.isErr() && result.error instanceof DockerNotFoundError) {
    const pull = await docker.pull(EXPLORE_HELPER_IMAGE);
    if (pull.isErr()) {
      out.sink.end();
      err.sink.end();
      return { ok: false, reason: pull.error.message };
    }
    await new Promise<void>((resolve, reject) => {
      followProgress(pull.value, (e) => (e ? reject(e) : resolve()));
    }).catch(() => undefined);
    result = await docker.run(EXPLORE_HELPER_IMAGE, cmd, [out.sink, err.sink], options);
  }
  if (result.isErr()) {
    // The run never attached, so the sinks would otherwise dangle unended.
    out.sink.end();
    err.sink.end();
    return { ok: false, reason: result.error.message };
  }
  const [stdout, stderrBuf] = await Promise.all([out.done, err.done]);
  return {
    ok: true,
    capture: {
      statusCode: result.value.output.StatusCode,
      stdout,
      stderr: stderrBuf.toString("utf8"),
    },
  };
}

// ─── Service operations ────────────────────────────────────────────────────

export type VolumeExploreError = "not-found" | "invalid-path" | "error";
interface ExploreFailure {
  ok: false;
  kind: VolumeExploreError;
  reason: string;
}

/** Volume existence pre-check: mounting a missing named volume would silently
 *  CREATE it on the daemon, so browsing must never reach `docker run` first. */
async function assertVolume(name: string): Promise<ExploreFailure | null> {
  const inspected = await docker.volumes.inspect(name);
  if (inspected.isErr()) {
    const kind = inspected.error instanceof DockerNotFoundError ? "not-found" : "error";
    return { ok: false, kind, reason: inspected.error.message };
  }
  return null;
}

/** BusyBox utilities report ENOENT with this phrase on stderr. */
function looksLikeMissingPath(stderr: string): boolean {
  return /no such file or directory/i.test(stderr);
}

export async function listVolumeDir(
  volumeName: string,
  path: string,
): Promise<{ ok: true; path: string; entries: VolumeDirEntry[] } | ExploreFailure> {
  const resolved = resolveVolumeExplorePath(path);
  if (!resolved.ok) return { ok: false, kind: "invalid-path", reason: resolved.reason };

  const missing = await assertVolume(volumeName);
  if (missing) return missing;

  const run = await runExploreHelper(
    // Depth 0 (the directory itself) is kept on purpose: it distinguishes an
    // empty directory from a missing one, and a file from a directory.
    // prettier-ignore
    ["find", resolved.containerPath, "-maxdepth", "1", "-exec", "stat", "-c", STAT_LIST_FORMAT, "{}", "+"],
    volumeMountSpec(volumeName, { readOnly: true }),
  );
  if (!run.ok) return { ok: false, kind: "error", reason: run.reason };
  const { statusCode, stdout, stderr } = run.capture;
  if (statusCode !== 0) {
    if (looksLikeMissingPath(stderr)) {
      return {
        ok: false,
        kind: "not-found",
        reason: `no such path in volume: /${resolved.relative}`,
      };
    }
    return { ok: false, kind: "error", reason: stderr.trim() || `helper exited ${statusCode}` };
  }

  const listing = parseVolumeDirListing(stdout.toString("utf8"), resolved.containerPath);
  if (!listing.self) {
    return {
      ok: false,
      kind: "not-found",
      reason: `no such path in volume: /${resolved.relative}`,
    };
  }
  if (listing.self.kind !== "dir") {
    return { ok: false, kind: "invalid-path", reason: `/${resolved.relative} is not a directory` };
  }
  return { ok: true, path: resolved.relative, entries: listing.entries };
}

/**
 * Pre-read stat: existence, type, and full size. Refuses everything but
 * regular files: dereferencing a symlink would read out of the helper
 * container's own filesystem, not the volume.
 */
async function statRegularFile(
  containerPath: string,
  relative: string,
  mount: Mount,
): Promise<{ ok: true; size: number } | ExploreFailure> {
  const run = await runExploreHelper(["stat", "-c", "%F\t%s", containerPath], mount);
  if (!run.ok) return { ok: false, kind: "error", reason: run.reason };
  if (run.capture.statusCode !== 0) {
    if (looksLikeMissingPath(run.capture.stderr)) {
      return { ok: false, kind: "not-found", reason: `no such file in volume: /${relative}` };
    }
    return {
      ok: false,
      kind: "error",
      reason: run.capture.stderr.trim() || `stat exited ${run.capture.statusCode}`,
    };
  }
  const line = run.capture.stdout.toString("utf8").trim();
  const tab = line.lastIndexOf("\t");
  const typeText = tab === -1 ? line : line.slice(0, tab);
  const size = tab === -1 ? Number.NaN : Number(line.slice(tab + 1));
  if (!Number.isInteger(size) || size < 0) {
    return { ok: false, kind: "error", reason: `unparseable stat output: ${line}` };
  }
  if (!typeText.startsWith("regular")) {
    return {
      ok: false,
      kind: "invalid-path",
      reason: `/${relative} is a ${typeText}, not a regular file`,
    };
  }
  return { ok: true, size };
}

export interface VolumeFileView {
  /** UTF-8 text, or null when the file is binary. */
  content: string | null;
  binary: boolean;
  truncated: boolean;
  /** Full on-disk size in bytes (the content may be capped below it). */
  size: number;
}

export async function readVolumeFile(
  volumeName: string,
  path: string,
): Promise<{ ok: true; file: VolumeFileView } | ExploreFailure> {
  const resolved = resolveVolumeExplorePath(path);
  if (!resolved.ok) return { ok: false, kind: "invalid-path", reason: resolved.reason };
  if (resolved.relative === "") {
    return {
      ok: false,
      kind: "invalid-path",
      reason: "path must name a file, not the volume root",
    };
  }

  const missing = await assertVolume(volumeName);
  if (missing) return missing;

  const mount = volumeMountSpec(volumeName, { readOnly: true });

  const stat = await statRegularFile(resolved.containerPath, resolved.relative, mount);
  if (!stat.ok) return stat;

  const head = await runExploreHelper(
    ["head", "-c", String(VOLUME_FILE_READ_CAP), resolved.containerPath],
    mount,
  );
  if (!head.ok) return { ok: false, kind: "error", reason: head.reason };
  if (head.capture.statusCode !== 0) {
    return {
      ok: false,
      kind: "error",
      reason: head.capture.stderr.trim() || `head exited ${head.capture.statusCode}`,
    };
  }

  const bytes = head.capture.stdout;
  const binary = bytes.includes(0);
  return {
    ok: true,
    file: {
      content: binary ? null : bytes.toString("utf8"),
      binary,
      truncated: stat.size > VOLUME_FILE_READ_CAP,
      size: stat.size,
    },
  };
}
