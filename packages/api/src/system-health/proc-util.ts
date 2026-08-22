/**
 * Shared plumbing for the procfs collectors (proc-cpu, proc-io,
 * proc-filesystems, host-telemetry).
 *
 * Everything here is Linux-only in practice. On a platform with no procfs
 * (macOS dev) a read is `null` and nothing logs an error: absence is the
 * normal case, not a failure.
 */
import { Result } from "better-result";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/**
 * Where procfs lives. Raw process.env, like host-health's
 * HOST_HEALTH_DISK_PATH: the health agent runs in a container with no
 * validated env, and a containerised agent must be pointed at the HOST's
 * /proc (bind-mounted at /host/proc by the reconciler) or it would report its
 * own mounts and network namespace as the node's.
 */
export function procRoot(): string {
  // oxlint-disable-next-line node/no-process-env -- intentional raw read (see comment above)
  const override = process.env.HOST_PROC_PATH;
  return override && existsSync(override) ? override : "/proc";
}

/** Read a procfs file, or null when it is absent/unreadable. */
export async function readProcFile(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  const result = await Result.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: () => null,
  });
  return result.isOk() ? result.value : null;
}

/**
 * First readable path wins. Used for /proc/net/dev, where `<proc>/net` is a
 * symlink into the READER's network namespace: a containerised agent with the
 * host's /proc bind-mounted still has to go through pid 1 to see the host's
 * interfaces. Falls back to the plain path when that is not permitted.
 */
export async function readFirstProcFile(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    const text = await readProcFile(path);
    if (text !== null) return text;
  }
  return null;
}

export function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/** One decimal is all a percent-of-a-host is honestly worth. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function perSecond(delta: number, elapsedMs: number): number {
  return Math.round((delta / elapsedMs) * 1000);
}
