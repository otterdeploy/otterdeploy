import type { Port } from "@otterdeploy/docker";

import { Docker, DockerNotFoundError } from "@otterdeploy/docker";

import { isSwarmRuntime } from "../../runtime";
import { demuxDockerStream, readLines, splitDockerTimestamp } from "../../swarm/stream-parse";
import { guardImageRemoval, guardNetworkRemoval, guardVolumeRemoval } from "./guards";

const docker = Docker.fromEnv();

type Listed<T> =
  | { ok: true; items: T }
  | { ok: false; reason: string; kind?: "not_found" | "conflict" };

function failure(error: unknown): { ok: false; reason: string; kind?: "not_found" } {
  if (error instanceof DockerNotFoundError) {
    return { ok: false, reason: error.message, kind: "not_found" };
  }
  return { ok: false, reason: error instanceof Error ? error.message : String(error) };
}

/** Docker reports volume/network creation as RFC3339 strings; normalize to
 *  unix seconds so every resource's `createdAt` is a number for the client. */
function epochSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export interface ListedContainer {
  id: string;
  name: string;
  image: string;
  command: string;
  state: string;
  status: string;
  ports: string[];
  createdAt: number;
}

export interface ListedImage {
  id: string;
  repoTags: string[];
  size: number;
  createdAt: number;
  containers: number;
}

export interface ListedVolume {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  createdAt: number | null;
  size: number;
  refCount: number;
}

export interface ListedNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  createdAt: number;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  subnet: string | null;
  gateway: string | null;
  containers: number;
}

export interface ListedTask {
  id: string;
  serviceId: string;
  slot: number | null;
  nodeId: string;
  desiredState: string;
  state: string;
  message: string | null;
  image: string | null;
  createdAt: string | null;
}

export interface ListedNode {
  id: string;
  hostname: string;
  role: string;
  availability: string;
  state: string;
  addr: string | null;
  leader: boolean;
}

export interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
  ts: string | null;
}

/** Render docker's Port entries as `docker ps`-style strings, deduped —
 *  the daemon repeats a published port once per host IP (v4 + v6). */
function formatPorts(ports: Port[] | undefined): string[] {
  if (!ports || ports.length === 0) return [];
  const out = new Set<string>();
  for (const p of ports) {
    if (p.PublicPort != null) {
      const host = p.IP && p.IP !== "0.0.0.0" && p.IP !== "::" ? `${p.IP}:` : "";
      out.add(`${host}${p.PublicPort}→${p.PrivatePort}/${p.Type}`);
    } else {
      out.add(`${p.PrivatePort}/${p.Type}`);
    }
  }
  return [...out];
}

export async function listContainers(opts: { all?: boolean }): Promise<Listed<ListedContainer[]>> {
  const result = await docker.containers.list({ all: opts.all ?? false });
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: result.value.map((c) => ({
      id: c.Id,
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
      image: c.Image,
      command: c.Command ?? "",
      state: c.State,
      status: c.Status,
      ports: formatPorts(c.Ports),
      createdAt: c.Created,
    })),
  };
}

export async function listImages(opts: { all?: boolean }): Promise<Listed<ListedImage[]>> {
  const result = await docker.images.list({ all: opts.all ?? false });
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: result.value.map((img) => ({
      id: img.Id,
      repoTags: img.RepoTags ?? [],
      size: img.Size,
      createdAt: img.Created,
      containers: img.Containers,
    })),
  };
}

export async function listVolumes(): Promise<Listed<ListedVolume[]>> {
  const result = await docker.volumes.list();
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: (result.value.Volumes ?? []).map((v) => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      scope: v.Scope,
      createdAt: epochSeconds(v.CreatedAt),
      size: v.UsageData?.Size ?? -1,
      refCount: v.UsageData?.RefCount ?? -1,
    })),
  };
}

export async function listNetworks(): Promise<Listed<ListedNetwork[]>> {
  const result = await docker.networks.list();
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: result.value.map((n) => {
      const ipam = n.IPAM?.Config?.[0];
      return {
        id: n.Id,
        name: n.Name,
        driver: n.Driver,
        scope: n.Scope,
        createdAt: epochSeconds(n.Created) ?? 0,
        internal: n.Internal ?? false,
        attachable: n.Attachable ?? false,
        ingress: n.Ingress ?? false,
        subnet: ipam?.Subnet ?? null,
        gateway: ipam?.Gateway ?? null,
        containers: n.Containers ? Object.keys(n.Containers).length : 0,
      };
    }),
  };
}

export async function listTasks(): Promise<Listed<ListedTask[]>> {
  // Swarm-only API. Under the DEFAULT plain-docker runtime there are no tasks —
  // return an empty list instead of surfacing the daemon's "not a swarm manager"
  // error as a SERVER_ERROR on the debug page's Tasks tab.
  if (!isSwarmRuntime()) return { ok: true, items: [] };
  const result = await docker.tasks.list();
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: result.value.map((t) => {
      const spec = t.Spec as { ContainerSpec?: { Image?: string } } | undefined;
      return {
        id: t.ID ?? "",
        serviceId: t.ServiceID ?? "",
        slot: t.Slot ?? null,
        nodeId: t.NodeID ?? "",
        desiredState: t.DesiredState ?? "",
        state: t.Status?.State ?? "",
        message: t.Status?.Err || t.Status?.Message || null,
        image: spec?.ContainerSpec?.Image ?? null,
        createdAt: t.CreatedAt ?? null,
      };
    }),
  };
}

export async function listNodes(): Promise<Listed<{ swarm: boolean; nodes: ListedNode[] }>> {
  // Same swarm gate as listTasks — a plain-docker daemon has no /nodes API.
  if (!isSwarmRuntime()) return { ok: true, items: { swarm: false, nodes: [] } };
  const result = await docker.nodes.list();
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: {
      swarm: true,
      nodes: result.value.map((n) => ({
        id: n.ID ?? "",
        hostname: n.Description?.Hostname ?? n.ID ?? "",
        role: n.Spec?.Role ?? "worker",
        availability: n.Spec?.Availability ?? "active",
        state: (n.Status as { State?: string } | undefined)?.State ?? "",
        addr: (n.Status as { Addr?: string } | undefined)?.Addr ?? null,
        leader: n.ManagerStatus?.Leader ?? false,
      })),
    },
  };
}

// ─── inspect (raw JSON passthrough) ─────────────────────────────────────────

export async function inspectContainer(id: string): Promise<Listed<unknown>> {
  const result = await docker.containers.inspect(id);
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: result.value };
}

export async function inspectImage(id: string): Promise<Listed<unknown>> {
  const result = await docker.images.getImage(id).inspect();
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: result.value };
}

export async function inspectVolume(name: string): Promise<Listed<unknown>> {
  const result = await docker.volumes.inspect(name);
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: result.value };
}

export async function inspectNetwork(id: string): Promise<Listed<unknown>> {
  const result = await docker.networks.inspect(id);
  if (result.isErr()) return failure(result.error);
  return { ok: true, items: result.value };
}

// ─── container logs (bounded tail, no follow) ───────────────────────────────

export async function tailContainerLogs(id: string, tail: number): Promise<Listed<LogLine[]>> {
  const container = docker.containers.getContainer(id);

  // TTY containers stream raw bytes; non-TTY streams carry docker's 8-byte
  // multiplex framing. Inspect first so we pick the right parser.
  const inspected = await container.inspect();
  if (inspected.isErr()) return failure(inspected.error);
  const tty = Boolean((inspected.value as { Config?: { Tty?: boolean } }).Config?.Tty);

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
      lines.push({ stream: "stdout", line, ts });
    }
  } else {
    for await (const chunk of demuxDockerStream(logsResult.value)) {
      const { ts, line } = splitDockerTimestamp(chunk.line);
      lines.push({ stream: chunk.stream, line, ts });
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
  const deleted = result.value.ImagesDeleted as Array<unknown> | null | undefined;
  return {
    ok: true,
    items: {
      imagesDeleted: Array.isArray(deleted) ? deleted.length : 0,
      reclaimedBytes: result.value.SpaceReclaimed ?? 0,
    },
  };
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
