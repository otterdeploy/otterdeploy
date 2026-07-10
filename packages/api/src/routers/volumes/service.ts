/**
 * Volumes service — daemon reads/writes + the org-scoped enrichment pass.
 * Follows the docker router's `Listed<T>` convention: handlers get either the
 * items or a plain failure reason to surface as a typed oRPC error.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { Docker, DockerConflictError, DockerNotFoundError } from "@otterdeploy/docker";

import type { VolumeAttachment, VolumeContainerRef } from "./mapping";

import { buildVolumeMappingIndex, mapVolume } from "./mapping";
import { loadOrgVolumeClaims } from "./queries";

const docker = Docker.fromEnv();

/** Docker reports volume creation as RFC3339 strings; normalize to unix seconds. */
function epochSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export interface EnrichedVolume {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  createdAt: number | null;
  labels: Record<string, string>;
  sizeBytes: number;
  refCount: number;
  containerNames: string[];
  attachedTo: VolumeAttachment[];
  orphan: boolean;
}

export interface VolumesListResult {
  node: { name: string; serverVersion: string } | null;
  drivers: string[];
  volumes: EnrichedVolume[];
}

type Listed<T> = { ok: true; items: T } | { ok: false; reason: string };

/** All daemon containers (any state) reduced to their named-volume mounts. */
async function listVolumeContainerRefs(): Promise<VolumeContainerRef[]> {
  const result = await docker.containers.list({ all: true });
  if (result.isErr()) return [];
  return result.value.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
    labels: c.Labels ?? {},
    volumeNames: (c.Mounts ?? [])
      .filter((m) => m.Type === "volume" && typeof m.Name === "string" && m.Name.length > 0)
      .map((m) => m.Name as string),
  }));
}

/** Measured bytes per volume from `system df` (empty map when unavailable —
 *  the endpoint can be slow/unsupported; sizes then render as unknown). */
async function volumeSizesFromDf(): Promise<Map<string, number>> {
  const result = await docker.system.df();
  if (result.isErr()) return new Map();
  const sizes = new Map<string, number>();
  for (const v of result.value.Volumes ?? []) {
    const size = v.UsageData?.Size;
    if (typeof size === "number" && size >= 0) sizes.set(v.Name, size);
  }
  return sizes;
}

/** Daemon identity + installed volume drivers, best-effort. */
async function daemonInfo(): Promise<{
  node: { name: string; serverVersion: string } | null;
  drivers: string[];
}> {
  const result = await docker.system.info();
  if (result.isErr()) return { node: null, drivers: ["local"] };
  const info = result.value;
  const plugins = info.Plugins as { Volume?: string[] } | undefined;
  const drivers =
    Array.isArray(plugins?.Volume) && plugins.Volume.length > 0 ? plugins.Volume : ["local"];
  return {
    node: { name: info.Name, serverVersion: info.ServerVersion },
    drivers,
  };
}

export async function listEnrichedVolumes(
  organizationId: OrganizationId,
): Promise<Listed<VolumesListResult>> {
  const listed = await docker.volumes.list();
  if (listed.isErr()) return { ok: false, reason: listed.error.message };

  const [containers, sizes, info, orgClaims] = await Promise.all([
    listVolumeContainerRefs(),
    volumeSizesFromDf(),
    daemonInfo(),
    loadOrgVolumeClaims(organizationId),
  ]);

  const index = buildVolumeMappingIndex({
    containers,
    claims: orgClaims.claims,
    stackClaims: orgClaims.stackClaims,
    resources: orgClaims.resources,
  });

  const volumes: EnrichedVolume[] = (listed.value.Volumes ?? []).map((v) => {
    const mapped = mapVolume(v.Name, index);
    return {
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      scope: v.Scope,
      createdAt: epochSeconds(v.CreatedAt),
      labels: v.Labels ?? {},
      sizeBytes: sizes.get(v.Name) ?? v.UsageData?.Size ?? -1,
      ...mapped,
    };
  });

  // Stable order: attached first, then by name — keeps polling refreshes calm.
  volumes.sort(
    (a, b) => Number(b.refCount > 0) - Number(a.refCount > 0) || a.name.localeCompare(b.name),
  );

  return { ok: true, items: { node: info.node, drivers: info.drivers, volumes } };
}

export type VolumeMutationError = "not-found" | "conflict" | "error";

export async function inspectVolume(
  name: string,
): Promise<
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; kind: VolumeMutationError; reason: string }
> {
  const result = await docker.volumes.inspect(name);
  if (result.isErr()) {
    const kind = result.error instanceof DockerNotFoundError ? "not-found" : "error";
    return { ok: false, kind, reason: result.error.message };
  }
  return { ok: true, raw: result.value as Record<string, unknown> };
}

export async function createVolume(input: {
  name: string;
  driver: string;
  labels?: Record<string, string>;
}): Promise<
  | {
      ok: true;
      volume: {
        name: string;
        driver: string;
        mountpoint: string;
        createdAt: number | null;
        labels: Record<string, string>;
      };
    }
  | { ok: false; kind: VolumeMutationError; reason: string }
> {
  // `docker volume create` is idempotent for an existing name+driver, which
  // would silently "succeed" without creating anything — pre-check so the
  // operator gets an honest 409 instead.
  const existing = await docker.volumes.inspect(input.name);
  if (existing.isOk()) {
    return { ok: false, kind: "conflict", reason: `Volume ${input.name} already exists` };
  }

  const created = await docker.volumes.create({
    Name: input.name,
    Driver: input.driver,
    Labels: input.labels ?? {},
  });
  if (created.isErr()) {
    const kind = created.error instanceof DockerConflictError ? "conflict" : "error";
    return { ok: false, kind, reason: created.error.message };
  }
  const v = created.value;
  return {
    ok: true,
    volume: {
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      createdAt: epochSeconds(v.CreatedAt),
      labels: v.Labels ?? {},
    },
  };
}

export async function removeVolume(
  name: string,
  organizationId: OrganizationId,
): Promise<{ ok: true } | { ok: false; kind: VolumeMutationError; reason: string }> {
  const existing = await docker.volumes.inspect(name);
  if (existing.isErr()) {
    const kind = existing.error instanceof DockerNotFoundError ? "not-found" : "error";
    return { ok: false, kind, reason: existing.error.message };
  }

  // In-use / claimed guard. The daemon only rejects removal while a container
  // references the volume; a platform-claimed volume with its container
  // temporarily gone would delete cleanly and lose data — refuse both.
  const [containers, orgClaims] = await Promise.all([
    listVolumeContainerRefs(),
    loadOrgVolumeClaims(organizationId),
  ]);
  const index = buildVolumeMappingIndex({
    containers,
    claims: orgClaims.claims,
    stackClaims: orgClaims.stackClaims,
    resources: orgClaims.resources,
  });
  const mapped = mapVolume(name, index);
  if (mapped.refCount > 0) {
    return {
      ok: false,
      kind: "conflict",
      reason: `Volume is mounted by ${mapped.containerNames.slice(0, 3).join(", ")}${
        mapped.containerNames.length > 3 ? ` and ${mapped.containerNames.length - 3} more` : ""
      }`,
    };
  }
  const owner = mapped.attachedTo[0];
  if (owner) {
    return {
      ok: false,
      kind: "conflict",
      reason: `Volume belongs to ${owner.resourceType} "${owner.resourceName}" (${owner.projectSlug}) — delete the resource instead`,
    };
  }

  const removed = await docker.volumes.getVolume(name).remove();
  if (removed.isErr()) {
    const kind =
      removed.error instanceof DockerConflictError
        ? "conflict"
        : removed.error instanceof DockerNotFoundError
          ? "not-found"
          : "error";
    return { ok: false, kind, reason: removed.error.message };
  }
  return { ok: true };
}
