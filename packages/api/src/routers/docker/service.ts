/**
 * Docker debug service — read-only list functions over the daemon
 * (containers, images, volumes, networks, tasks, nodes). Inspect, log
 * tails, and guarded destructive operations live in service-admin.ts;
 * the shared client + result shape in client.ts.
 */
import type { Port } from "@otterdeploy/docker";

import { isSwarmRuntime } from "../../runtime";
import { docker, type Listed } from "./client";

export * from "./service-admin";

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

/** A task's error takes precedence over its informational message. */
function taskMessage(status: { Err?: string; Message?: string } | undefined): string | null {
  return status?.Err || status?.Message || null;
}

function taskImage(spec: unknown): string | null {
  const s = spec as { ContainerSpec?: { Image?: string } } | undefined;
  return s?.ContainerSpec?.Image ?? null;
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
    items: result.value.map((t) => ({
      id: t.ID ?? "",
      serviceId: t.ServiceID ?? "",
      slot: t.Slot ?? null,
      nodeId: t.NodeID ?? "",
      desiredState: t.DesiredState ?? "",
      state: t.Status?.State ?? "",
      message: taskMessage(t.Status),
      image: taskImage(t.Spec),
      createdAt: t.CreatedAt ?? null,
    })),
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
