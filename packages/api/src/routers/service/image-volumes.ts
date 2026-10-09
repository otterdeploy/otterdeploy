/**
 * Persistent backing for the paths an image declares as `VOLUME`.
 *
 * Docker gives each `VOLUME` path an ANONYMOUS volume per container. A deploy
 * replaces the container, the new one gets a fresh anonymous volume, and
 * whatever the app wrote there (gitea's repositories, vaultwarden's vault,
 * navidrome's library index) is gone. The builder used to refuse such
 * Dockerfiles outright, which blocked many widely used apps and offered no
 * way through. Instead, every declared path is now backed by a named volume
 * attached to the service, the same `service_mount` row `otterdeploy volume
 * add` writes, so the data survives redeploys and is visible, backed up, and
 * removable like any other volume.
 *
 * A path the operator already attached something to (a volume, a bind, a
 * file) is theirs and is left alone: their mount is what docker puts at that
 * path, so no anonymous volume is created there at all.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceMount } from "@otterdeploy/db/schema/project";

import { listServiceMounts } from "./queries/mounts";
import { buildServiceVolumeName, normalizeMountPath } from "./volume-name";

/** What happens to one declared `VOLUME` path. */
export type ImageVolumeBacking =
  | { path: string; kind: "attached"; mountType: "volume" | "bind" | "file"; source: string | null }
  | { path: string; kind: "created"; volumeName: string };

/**
 * Decide the backing for each declared path. PURE: `existing` is the service's
 * current mount set. Duplicate and `/data/`-vs-`/data` spellings collapse to
 * one path, so a Dockerfile that repeats a VOLUME never asks for two volumes.
 */
export function planImageVolumes(input: {
  serviceName: string;
  declared: readonly string[];
  existing: ReadonlyArray<{
    target: string;
    type: "volume" | "bind" | "file";
    source: string | null;
  }>;
}): ImageVolumeBacking[] {
  const byTarget = new Map(input.existing.map((m) => [normalizeMountPath(m.target), m]));
  const paths = [...new Set(input.declared.map(normalizeMountPath))].sort((a, b) =>
    a.localeCompare(b),
  );
  return paths.map((path): ImageVolumeBacking => {
    const mount = byTarget.get(path);
    if (mount) return { path, kind: "attached", mountType: mount.type, source: mount.source };
    return {
      path,
      kind: "created",
      volumeName: buildServiceVolumeName({ serviceName: input.serviceName, mountPath: path }),
    };
  });
}

/**
 * Back every declared path that has no mount yet with a named volume, and
 * report what each path ended up on. Never overwrites: a mount the operator
 * attaches between the read and the write wins (the insert is a no-op on the
 * (service, target) unique index), and the next deploy reports it as attached.
 */
export async function backImageVolumes(input: {
  serviceResourceId: ResourceId;
  serviceName: string;
  declared: readonly string[];
}): Promise<ImageVolumeBacking[]> {
  if (input.declared.length === 0) return [];
  const existing = await listServiceMounts(input.serviceResourceId);
  const plan = planImageVolumes({
    serviceName: input.serviceName,
    declared: input.declared,
    existing,
  });
  const creates = plan.flatMap((b) => (b.kind === "created" ? [b] : []));
  if (creates.length > 0) {
    await db
      .insert(serviceMount)
      .values(
        creates.map((b) => ({
          serviceResourceId: input.serviceResourceId,
          type: "volume" as const,
          target: b.path,
          source: b.volumeName,
          content: null,
          readOnly: false,
        })),
      )
      .onConflictDoNothing({ target: [serviceMount.serviceResourceId, serviceMount.target] });
  }
  return plan;
}
