/**
 * Pure attached-to / orphan mapping for the volumes router.
 *
 * A daemon volume belongs to a platform resource through one of four links:
 *
 *   1. container label — a container mounting the volume carries the
 *      provisioner's `otterdeploy.resource.id` label (databases + git-sourced
 *      services stamp it on every task container).
 *   2. stack namespace — a container mounting the volume carries
 *      `com.docker.stack.namespace=<stackName>`, which maps to a compose
 *      resource's unique `stack_name`.
 *   3. name-convention claim — database volumes are named
 *      `otterdeploy-<enginePrefix>data-<projectSlug>-<resourceName>` by
 *      `buildVolumeName` (plus `legacy_volume_name` for pre-migration rows),
 *      and compose stack volumes are prefixed `<stackName>_`. These claims
 *      hold even when the owning container is currently gone.
 *   4. mount row claim — `service_mount` rows with `type=volume` record the
 *      exact volume name a service mounts.
 *
 * Orphan = zero containers reference the volume AND no resource claims it.
 * All inputs are plain data so this file stays unit-testable without a
 * daemon or database.
 */

export interface VolumeContainerRef {
  id: string;
  name: string;
  labels: Record<string, string>;
  /** Names of the named volumes this container mounts (Mounts[].Name, Type=volume). */
  volumeNames: string[];
}

/** A resource claiming a volume by its exact name (rules 3 + 4 above). */
export interface VolumeClaim {
  volumeName: string;
  resourceId: string;
  resourceName: string;
  resourceType: "database" | "service" | "compose";
  projectId: string;
  projectSlug: string;
  engine: string | null;
}

/** A compose stack claiming every volume under its `<stackName>_` prefix. */
export interface StackClaim {
  stackName: string;
  resourceId: string;
  resourceName: string;
  projectId: string;
  projectSlug: string;
}

/** Org resource directory for resolving container labels → resource. */
export interface ResourceInfo {
  resourceId: string;
  resourceName: string;
  resourceType: "database" | "service" | "compose";
  projectId: string;
  projectSlug: string;
  engine: string | null;
}

export interface VolumeAttachment {
  resourceId: string;
  resourceName: string;
  resourceType: "database" | "service" | "compose";
  projectId: string;
  projectSlug: string;
  engine: string | null;
  via: "container" | "claim";
}

export interface VolumeMappingIndex {
  /** All containers on the daemon (any state), with their volume mounts. */
  containersByVolume: Map<string, VolumeContainerRef[]>;
  claimsByVolume: Map<string, VolumeClaim[]>;
  stackClaims: StackClaim[];
  resourcesById: Map<string, ResourceInfo>;
  stacksByNamespace: Map<string, StackClaim>;
}

export const RESOURCE_ID_LABEL = "otterdeploy.resource.id";
export const STACK_NAMESPACE_LABEL = "com.docker.stack.namespace";

/** Pre-index containers/claims once so per-volume mapping is O(refs). */
export function buildVolumeMappingIndex(input: {
  containers: VolumeContainerRef[];
  claims: VolumeClaim[];
  stackClaims: StackClaim[];
  resources: ResourceInfo[];
}): VolumeMappingIndex {
  const containersByVolume = new Map<string, VolumeContainerRef[]>();
  for (const c of input.containers) {
    for (const v of c.volumeNames) {
      const list = containersByVolume.get(v);
      if (list) list.push(c);
      else containersByVolume.set(v, [c]);
    }
  }
  const claimsByVolume = new Map<string, VolumeClaim[]>();
  for (const claim of input.claims) {
    const list = claimsByVolume.get(claim.volumeName);
    if (list) list.push(claim);
    else claimsByVolume.set(claim.volumeName, [claim]);
  }
  const resourcesById = new Map(input.resources.map((r) => [r.resourceId, r]));
  const stacksByNamespace = new Map(input.stackClaims.map((s) => [s.stackName, s]));
  return {
    containersByVolume,
    claimsByVolume,
    stackClaims: input.stackClaims,
    resourcesById,
    stacksByNamespace,
  };
}

function stackAttachment(stack: StackClaim, via: "container" | "claim"): VolumeAttachment {
  return {
    resourceId: stack.resourceId,
    resourceName: stack.resourceName,
    resourceType: "compose",
    projectId: stack.projectId,
    projectSlug: stack.projectSlug,
    engine: null,
    via,
  };
}

/**
 * Resolve one volume's attachments + usage. Attachments are deduped by
 * resource id; a live container link wins over a passive claim for the same
 * resource (its `via` is more informative).
 */
export function mapVolume(
  volumeName: string,
  index: VolumeMappingIndex,
): {
  refCount: number;
  containerNames: string[];
  attachedTo: VolumeAttachment[];
  orphan: boolean;
} {
  const containers = index.containersByVolume.get(volumeName) ?? [];
  const byResource = new Map<string, VolumeAttachment>();

  // 1 + 2: live container mounts, resolved through labels.
  for (const c of containers) {
    const resourceId = c.labels[RESOURCE_ID_LABEL];
    const resource = resourceId ? index.resourcesById.get(resourceId) : undefined;
    if (resource) {
      byResource.set(resource.resourceId, {
        resourceId: resource.resourceId,
        resourceName: resource.resourceName,
        resourceType: resource.resourceType,
        projectId: resource.projectId,
        projectSlug: resource.projectSlug,
        engine: resource.engine,
        via: "container",
      });
      continue;
    }
    const namespace = c.labels[STACK_NAMESPACE_LABEL];
    const stack = namespace ? index.stacksByNamespace.get(namespace) : undefined;
    if (stack) byResource.set(stack.resourceId, stackAttachment(stack, "container"));
  }

  // 3 + 4: passive claims by exact name (never downgrade a container link).
  for (const claim of index.claimsByVolume.get(volumeName) ?? []) {
    if (byResource.has(claim.resourceId)) continue;
    byResource.set(claim.resourceId, {
      resourceId: claim.resourceId,
      resourceName: claim.resourceName,
      resourceType: claim.resourceType,
      projectId: claim.projectId,
      projectSlug: claim.projectSlug,
      engine: claim.engine,
      via: "claim",
    });
  }

  // 3b: compose stack prefix claims (`<stackName>_<volumeKey>`).
  for (const stack of index.stackClaims) {
    if (byResource.has(stack.resourceId)) continue;
    if (volumeName.startsWith(`${stack.stackName}_`)) {
      byResource.set(stack.resourceId, stackAttachment(stack, "claim"));
    }
  }

  const attachedTo = [...byResource.values()];
  return {
    refCount: containers.length,
    containerNames: containers.map((c) => c.name),
    attachedTo,
    orphan: containers.length === 0 && attachedTo.length === 0,
  };
}
