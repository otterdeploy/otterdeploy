import { HELPER_LABEL } from "../../lib/helper-container";
/**
 * Docker debug service: inspect passthroughs, bounded log tails, and the
 * guarded destructive operations (image/volume/network removal, prune).
 * Split out of service.ts, which keeps the read-only list functions.
 */
import { demuxDockerStream, readLines, splitDockerTimestamp } from "../../swarm/stream-parse";
import { docker, failure, type Listed } from "./client";
import { guardImageRemoval, guardNetworkRemoval, guardVolumeRemoval } from "./guards";
import {
  redactSensitiveText,
  safeContainerInspect,
  safeImageInspect,
  safeNetworkInspect,
  safeVolumeInspect,
  type SafeContainerInspect,
  type SafeImageInspect,
  type SafeNetworkInspect,
  type SafeVolumeInspect,
} from "./safe-view";

export interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
  ts: string | null;
}

// ─── inspect (typed allowlisted views) ──────────────────────────────────────

export async function inspectContainer(id: string): Promise<Listed<SafeContainerInspect>> {
  const result = await docker.containers.inspect(id);
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: safeContainerInspect(result.value) };
}

export async function inspectImage(id: string): Promise<Listed<SafeImageInspect>> {
  const result = await docker.images.getImage(id).inspect();
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: safeImageInspect(result.value) };
}

export async function inspectVolume(name: string): Promise<Listed<SafeVolumeInspect>> {
  const result = await docker.volumes.inspect(name);
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: safeVolumeInspect(result.value) };
}

export async function inspectNetwork(id: string): Promise<Listed<SafeNetworkInspect>> {
  const result = await docker.networks.inspect(id);
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: safeNetworkInspect(result.value) };
}

// ─── container logs (bounded tail, no follow) ───────────────────────────────

export async function tailContainerLogs(id: string, tail: number): Promise<Listed<LogLine[]>> {
  const container = docker.containers.getContainer(id);

  // TTY containers stream raw bytes; non-TTY streams carry docker's 8-byte
  // multiplex framing. Inspect first so we pick the right parser.
  const inspected = await container.inspect();
  if (inspected.isErr()) return failure(inspected.error);
  const tty = Boolean(inspected.value.Config?.Tty);

  const logsResult = await container.logs({
    follow: false,
    stdout: true,
    stderr: true,
    timestamps: true,
    tail: String(tail),
  });
  if (logsResult.isErr()) return failure(logsResult.error);

  const lines: LogLine[] = [];
  if (tty) {
    for await (const raw of readLines(logsResult.value)) {
      const { ts, line } = splitDockerTimestamp(raw);
      lines.push({ stream: "stdout", line: redactSensitiveText(line), ts });
    }
  } else {
    for await (const chunk of demuxDockerStream(logsResult.value)) {
      const { ts, line } = splitDockerTimestamp(chunk.line);
      lines.push({ stream: chunk.stream, line: redactSensitiveText(line), ts });
    }
  }
  // `tail` bounds what the daemon sends, but clamp anyway in case a TTY
  // stream splits differently than the daemon counted.
  return { ok: true, items: lines.slice(-tail) };
}

// ─── destructive operations (guarded) ───────────────────────────────────────

/** Containers (running or stopped) whose image resolves to this image id. */
async function containersUsingImage(imageId: string): Promise<Listed<number>> {
  const result = await docker.containers.list({ all: true });
  if (result.isErr()) return { ok: false, reason: result.error.message };
  const short = imageId.replace(/^sha256:/, "");
  const count = result.value.filter(
    (c) => c.ImageID === imageId || c.ImageID?.replace(/^sha256:/, "") === short,
  ).length;
  return { ok: true, items: count };
}

export async function removeImage(
  id: string,
  force: boolean,
): Promise<Listed<{ deleted: number; untagged: number }>> {
  const usage = await containersUsingImage(id);
  if (!usage.ok) return usage;
  const guard = guardImageRemoval({ inUseBy: usage.items, force });
  if (!guard.ok) return { ok: false, reason: guard.reason, kind: "conflict" };

  const result = await docker.images.getImage(id).remove({ force });
  if (result.isErr()) return failure(result.error);
  return {
    ok: true,
    items: {
      deleted: result.value.filter((r) => r.Deleted).length,
      untagged: result.value.filter((r) => r.Untagged).length,
    },
  };
}

export async function pruneImages(): Promise<
  Listed<{ imagesDeleted: number; reclaimedBytes: number }>
> {
  // Dangling-only: untagged leftover layers from rebuilds. Never prunes
  // tagged images (that would eat the deploy cache).
  const result = await docker.images.prune({ filters: { dangling: ["true"] } });
  if (result.isErr()) return failure(result.error);
  // PruneResponse only types SpaceReclaimed; ImagesDeleted arrives through its
  // index signature as `unknown`, and Array.isArray below is the real check.
  const deleted = result.value.ImagesDeleted;
  return {
    ok: true,
    items: {
      imagesDeleted: Array.isArray(deleted) ? deleted.length : 0,
      reclaimedBytes: result.value.SpaceReclaimed ?? 0,
    },
  };
}

/**
 * Sweep leaked control-plane helper containers.
 *
 * Helpers are one-shot containers the control plane spawns over the socket
 * (see lib/helper-container). They set `AutoRemove`, so the daemon reaps them
 * when they exit: but a container that is CREATED and then never starts (disk
 * full is the classic trigger) never exits, so AutoRemove never fires and it
 * sits there forever. That is how a host ends up with a pile of `Created`
 * helpers on the very disk that was already full.
 *
 * Only non-running helpers are touched, matched by the helper label: a
 * running one is doing work for a request in flight, and an unlabeled
 * container is somebody's workload and is never ours to remove.
 */
export async function pruneHelperContainers(): Promise<Listed<{ containersDeleted: number }>> {
  const listed = await docker.containers.list({
    all: true,
    filters: { label: [`${HELPER_LABEL}`], status: ["created", "exited", "dead"] },
  });
  if (listed.isErr()) return failure(listed.error);

  let containersDeleted = 0;
  for (const c of listed.value) {
    const removed = await docker.containers.getContainer(c.Id).remove({ force: true });
    // A helper that self-removed between the list and the remove is the
    // expected race, not a failure: it is gone either way.
    if (removed.isOk()) containersDeleted += 1;
  }
  return { ok: true, items: { containersDeleted } };
}

/** Names of containers (running or stopped) that mount this volume. */
async function volumeAttachments(name: string): Promise<Listed<string[]>> {
  const result = await docker.containers.list({ all: true });
  if (result.isErr()) return { ok: false, reason: result.error.message };
  const names = result.value
    .filter((c) => (c.Mounts ?? []).some((m) => m.Type === "volume" && m.Name === name))
    .map((c) => (c.Names?.[0] ?? c.Id).replace(/^\//, ""));
  return { ok: true, items: names };
}

export async function removeVolume(name: string): Promise<Listed<{ removed: boolean }>> {
  const attached = await volumeAttachments(name);
  if (!attached.ok) return attached;
  const guard = guardVolumeRemoval({ attachedTo: attached.items });
  if (!guard.ok) return { ok: false, reason: guard.reason, kind: "conflict" };

  const result = await docker.volumes.getVolume(name).remove();
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: { removed: true } };
}

export async function removeNetwork(id: string): Promise<Listed<{ removed: boolean }>> {
  // Inspect first: the guard needs the real name, the Ingress flag, and the
  // live attachment count (the list payload can be stale by the time the
  // operator clicks Remove).
  const inspected = await docker.networks.inspect(id);
  if (inspected.isErr()) return failure(inspected.error);
  const net = inspected.value;
  const guard = guardNetworkRemoval({
    name: net.Name,
    ingress: net.Ingress ?? false,
    attached: net.Containers ? Object.keys(net.Containers).length : 0,
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, kind: "conflict" };

  const result = await docker.networks.getNetwork(id).remove();
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: { removed: true } };
}
