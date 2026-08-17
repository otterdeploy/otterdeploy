/**
 * Resource DELETE orchestration. The destructive half of resources.ts.
 *
 * Split out because delete is a fundamentally different job from the read side:
 * the reads in resources.ts are pure projections over the query layer, whereas
 * this file owns a multi-step, partially-failable teardown saga (manifest strip
 * → routes → runtime → volumes → row) whose per-engine ordering rules and
 * best-effort/orphan-GC fallbacks are the whole point. Keeping them in one file
 * meant a reader chasing "why is my card showing a stale image" had to page
 * past 170 lines of teardown, and vice versa. `deleteProjectResource` is
 * re-exported from `./resources` so every existing call site is unchanged.
 */

import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { ResourceRef as HostResourceRef } from "@otterdeploy/shared/paths";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ResourceRef } from "../scopes";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { branchDependencyConflict } from "../../lib/environment/branch-dependents";
import { reclaimDatabaseVolume, reclaimServiceHostArtifacts } from "../service/teardown";
import { DatabaseHasBranchesError, PostgresResourceNotFoundError } from "./errors";
import { removeDatabaseFromManifest, removeServiceFromManifest } from "./manifest";
import { getDatabaseProvisioner } from "./provisioners";
import { deleteResourceById, getProjectInOrg, getResourceById } from "./queries";
import { buildContainerName, buildVolumeName, sanitizeProjectSlug } from "./views";

/**
 * Tear down everything a deleted SERVICE leaves behind on the host. Delete used
 * to remove only DB rows + Caddy routes, which orphaned the running container
 * and leaked the built images (~2GB per commit sha), the buildx layer cache,
 * and the resource's volumes on disk. Every step is BEST-EFFORT: the DB rows are
 * the source of truth and are removed regardless, so a cleanup hiccup (a stopped
 * daemon, a missing dir) must never block the delete.
 */
async function teardownServiceRuntime(
  serviceName: string,
  ref: HostResourceRef,
  log: RequestLogger,
): Promise<void> {
  // Lazy-imported: transitively loads @otterdeploy/env/server (validated at
  // module load). Keep it out of resources.ts's import graph.
  const { runtime } = await import("../../runtime");
  // 1. Stop + remove the running container / swarm service. If the daemon is
  //    unreachable this best-effort destroy would silently leak the container;
  //    record it as an orphan so the GC sweep retries the teardown later
  //    instead of abandoning it (system-health/orphan-gc.ts).
  await runtime()
    .destroy({ serviceName }, log)
    .catch(async (cause) => {
      const { recordOrphanedResource } = await import("../../system-health/orphan-gc");
      await recordOrphanedResource({
        organizationId: ref.organizationId,
        resourceType: "service",
        ref: serviceName,
        projectId: ref.projectId,
        label: `service teardown failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        payload: {
          projectId: ref.projectId,
          resourceId: ref.resourceId,
          // Host-side paths are environment-keyed (null = main env) — carried so
          // a later GC retry can rebuild the resource's on-disk ref.
          environmentId: ref.environmentId,
        },
      });
    });
  // 2-4. Reclaim host artifacts (images, buildx cache, volumes). Shared with
  //      the manifest-apply delete path (service/handlers.ts deleteService).
  await reclaimServiceHostArtifacts(serviceName, ref, log);
}

/**
 * Tear down a deleted DATABASE: container, then volume, each independently
 * best-effort and each falling back to orphan-GC so nothing leaks silently.
 * Extracted from the switch so the container/volume failure interplay (a failed
 * container teardown makes the volume "in use", which is expected rather than a
 * second independent bug) reads as one story.
 */
async function teardownDatabaseRuntime(
  input: { serviceName: string; volumeName: string; engine: DatabaseEngine },
  ref: ResourceRef,
  log: RequestLogger,
): Promise<{ containerDestroyed: boolean; volumeReclaimed: boolean }> {
  const provisioner = getDatabaseProvisioner(input.engine);
  // Container teardown must never abort the delete. A crash-looped or
  // already-exited container (od-aww's postgres:18 repro) is exactly the
  // case that must still get cleaned up, and the DB row is the source of
  // truth regardless of daemon hiccups. On failure, hand it to the
  // orphan-GC sweep (same "service" resourceType it already retries
  // stuck service teardowns with) instead of leaking it silently.
  let containerDestroyed = true;
  try {
    await provisioner.destroy({ serviceName: input.serviceName }, log);
  } catch (cause) {
    containerDestroyed = false;
    const { recordOrphanedResource } = await import("../../system-health/orphan-gc");
    await recordOrphanedResource({
      organizationId: ref.organizationId,
      resourceType: "service",
      ref: input.serviceName,
      projectId: ref.projectId,
      label: `database teardown failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  // The volume only detaches once the container is actually gone, so a
  // failed container teardown makes this attempt a no-op "in use" error.
  // Expected, not a bug. Either way, fall back to orphan-GC on failure
  // (it retries with the org-scoped guarded remover once the container
  // teardown above has had a chance to land).
  const { removed: volumeReclaimed } = await reclaimDatabaseVolume(input.volumeName, log);
  if (!volumeReclaimed) {
    const { recordOrphanedResource } = await import("../../system-health/orphan-gc");
    await recordOrphanedResource({
      organizationId: ref.organizationId,
      resourceType: "volume",
      ref: input.volumeName,
      projectId: ref.projectId,
      label: containerDestroyed
        ? "database volume teardown failed"
        : "database volume teardown failed (container teardown also failed)",
    });
  }
  return { containerDestroyed, volumeReclaimed };
}

export async function deleteProjectResource(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<{ ok: true }, PostgresResourceNotFoundError | DatabaseHasBranchesError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    log.set({ resource: { outcome: "project_not_found" } });
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    log.set({ resource: { outcome: "resource_not_found" } });
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  switch (found.kind) {
    case "database": {
      // PRECONDITION, deliberately before the manifest strip below. That order
      // is load-bearing: the strip runs first so a partial teardown diffs as a
      // recoverable delete rather than a phantom create, but it also means a
      // failure discovered later leaves the manifest entry gone while the data
      // is still on disk. Under `zfs` the destroy WOULD fail there, because a
      // clone pins its origin snapshot.
      const branchConflict = await branchDependencyConflict(input.resourceId);
      if (branchConflict) {
        log.set({ resource: { outcome: "has_preview_branches" } });
        return Result.err(
          new DatabaseHasBranchesError({
            resourceId: input.resourceId,
            detail: branchConflict,
          }),
        );
      }

      const { engine } = found.record.database;
      const projectSlug = sanitizeProjectSlug(project.slug);
      const serviceName = buildContainerName({
        engine,
        projectSlug,
        resourceName: found.record.resource.name,
      });
      const volumeName = buildVolumeName({
        engine,
        projectSlug,
        resourceName: found.record.resource.name,
      });

      log.set({
        resource: {
          kind: engine,
          projectId: input.projectId,
          name: found.record.resource.name,
        },
      });

      // Strip it from the manifest FIRST, before any teardown: once a delete
      // starts the resource is no longer "desired", so a partial-teardown
      // failure can only ever diff as a (recoverable) delete, never a phantom
      // `create` ghost. A deployed resource must never revert to pending.
      await removeDatabaseFromManifest(
        { projectId: input.projectId, organizationId: input.organizationId },
        found.record.resource.name,
      );
      await deleteProxyRoutesByResource(input.resourceId);
      const { containerDestroyed, volumeReclaimed } = await teardownDatabaseRuntime(
        { serviceName, volumeName, engine },
        input,
        log,
      );
      await deleteResourceById(input.resourceId);
      await reconcile(log);

      log.set({
        teardown: {
          proxyRoutesRemoved: true,
          swarmDestroyed: containerDestroyed,
          volumeReclaimed,
          dbDeleted: true,
        },
      });
      break;
    }
    case "service": {
      // The row delete cascades to service_resource + ports + env vars via the
      // schema's onDelete: cascade; teardownServiceRuntime reclaims the host
      // side (container, built images, buildx cache, volumes).
      log.set({
        resource: {
          kind: "service",
          projectId: input.projectId,
          name: found.record.resource.name,
        },
      });
      // Strip it from the manifest FIRST (see the database branch) so a partial
      // teardown can never leave the service declared-but-absent → phantom
      // `create`. A deployed service must never revert to pending.
      await removeServiceFromManifest(
        { projectId: input.projectId, organizationId: input.organizationId },
        found.record.resource.name,
      );
      await deleteProxyRoutesByResource(input.resourceId);
      await teardownServiceRuntime(
        found.record.service.serviceName,
        // Host-side paths key on the resource's environment too (null = main) —
        // the row carries it; the API-scope ref does not.
        { ...input, environmentId: found.record.resource.environmentId ?? null },
        log,
      );
      await deleteResourceById(input.resourceId);
      log.set({
        teardown: { proxyRoutesRemoved: true, runtimeDestroyed: true, dbDeleted: true },
      });
      break;
    }
    case "compose": {
      // Stack deletion is compose.delete's job. It tears down every child
      // service, the swarm stack, routes, and seeded vars. Falling through
      // here would report success without removing anything.
      log.set({ resource: { outcome: "compose_not_deletable_here" } });
      return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
    }
  }

  return Result.ok({ ok: true });
}
