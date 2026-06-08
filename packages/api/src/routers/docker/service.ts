import { Docker } from "@otterdeploy/docker";

const docker = Docker.fromEnv();

type Listed<T> = { ok: true; items: T } | { ok: false; reason: string };

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
  state: string;
  status: string;
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
  createdAt: string | null;
}

export async function listContainers(opts: {
  all?: boolean;
}): Promise<Listed<ListedContainer[]>> {
  const result = await docker.containers.list({ all: opts.all ?? false });
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: result.value.map((c) => ({
      id: c.Id,
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
      createdAt: c.Created,
    })),
  };
}

export async function listImages(opts: {
  all?: boolean;
}): Promise<Listed<ListedImage[]>> {
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
    items: result.value.map((n) => ({
      id: n.Id,
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
      createdAt: epochSeconds(n.Created) ?? 0,
      internal: n.Internal ?? false,
      attachable: n.Attachable ?? false,
      containers: n.Containers ? Object.keys(n.Containers).length : 0,
    })),
  };
}

export async function listTasks(): Promise<Listed<ListedTask[]>> {
  const result = await docker.tasks.list();
  if (result.isErr()) return { ok: false, reason: result.error.message };
  return {
    ok: true,
    items: result.value.map((t) => ({
      id: t.ID ?? "",
      serviceId: t.ServiceID ?? "",
      slot: t.Slot ?? null,
      nodeId: t.NodeID ?? "",
      desiredState: t.DesiredState ?? "",
      state: t.Status?.State ?? "",
      message: t.Status?.Err || t.Status?.Message || null,
      createdAt: t.CreatedAt ?? null,
    })),
  };
}
