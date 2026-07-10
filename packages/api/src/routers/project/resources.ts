/**
 * Generic resource read/delete orchestration. Engine-specific create lives in
 * postgres.ts (and future siblings). Read/delete dispatch through the
 * DatabaseProvisioner factory so each engine plugs its own destroy semantics.
 */

import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectRef, ResourceRef } from "../scopes";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";
import { reclaimServiceHostArtifacts } from "../service/teardown";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import { getDatabaseProvisioner } from "./provisioners";
import {
  deleteResourceById,
  getProjectInOrg,
  getResourceById,
  listProjectResources as listProjectResourcesQuery,
} from "./queries";
import {
  buildContainerName,
  mapComposeResource,
  mapDatabaseResource,
  mapServiceResource,
  sanitizeProjectSlug,
  type ProjectResource,
} from "./views";

export type { ProjectResource };

/**
 * Live name-availability check for the new-resource wizard. Returns
 * `{ available: true, suggestion: null }` when the name is free, or
 * `{ available: false, suggestion: "<base>-N" }` with the lowest free
 * suffix when taken. Names are unique per `(projectId, name)` via the
 * `resource_project_name_unique` index — this just lets the UI fail
 * fast on blur instead of after submit.
 */
export async function checkResourceName(
  input: ProjectRef & { name: string },
): Promise<Result<{ available: boolean; suggestion: string | null }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const { databases, services } = await listProjectResourcesQuery(input.projectId);
  const used = new Set<string>();
  for (const row of databases) used.add(row.resource.name);
  for (const row of services) used.add(row.resource.name);

  const requested = input.name.trim();
  if (!used.has(requested)) {
    return Result.ok({ available: true, suggestion: null });
  }

  // Suffix `-N` until we find a free one. Bounded loop — projects with
  // 1000+ same-base names are extraordinary; cap at 1000 to keep this
  // cheap and predictable.
  for (let i = 2; i <= 1000; i++) {
    const candidate = `${requested}-${i}`;
    if (!used.has(candidate)) {
      return Result.ok({ available: false, suggestion: candidate });
    }
  }
  return Result.ok({ available: false, suggestion: null });
}

export async function listProjectResources(
  input: ProjectRef,
): Promise<Result<ProjectResource[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const { databases, services, composes } = await listProjectResourcesQuery(input.projectId);
  const [databaseViews, serviceViews, composeViews] = await Promise.all([
    Promise.all(databases.map((record) => mapDatabaseResource(record, project.slug))),
    Promise.all(services.map((record) => mapServiceResource(record))),
    Promise.all(composes.map((record) => mapComposeResource(record))),
  ]);

  return Result.ok([...databaseViews, ...serviceViews, ...composeViews]);
}

export async function getProjectResource(
  input: ResourceRef,
): Promise<Result<ProjectResource, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  switch (found.kind) {
    case "database":
      return Result.ok(await mapDatabaseResource(found.record, project.slug));
    case "service":
      return Result.ok(await mapServiceResource(found.record));
    default:
      // Stacks aren't served by the generic resource view — the compose
      // router (compose.get) owns their read model. Also the exhaustive
      // fallback: tsc can't prove the switch covers `found.kind`, so a
      // bare case list reads as "lacks ending return statement".
      return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
}

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
  ref: ResourceRef,
  log: RequestLogger,
): Promise<void> {
  // Lazy-imported: transitively loads @otterdeploy/env/server (validated at
  // module load) — keep it out of resources.ts's import graph.
  const { runtime } = await import("../../runtime");
  // 1. Stop + remove the running container / swarm service.
  await runtime()
    .destroy({ serviceName }, log)
    .catch(() => undefined);
  // 2-4. Reclaim host artifacts (images, buildx cache, volumes) — shared with
  //      the manifest-apply delete path (service/handlers.ts deleteService).
  await reclaimServiceHostArtifacts(serviceName, ref.projectId, ref.resourceId, log);
}

export async function deleteProjectResource(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<{ ok: true }, PostgresResourceNotFoundError>> {
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
      const provisioner = getDatabaseProvisioner(found.record.database.engine);
      const serviceName = buildContainerName({
        engine: found.record.database.engine,
        projectSlug: sanitizeProjectSlug(project.slug),
        resourceName: found.record.resource.name,
      });

      log.set({
        resource: {
          kind: found.record.database.engine,
          projectId: input.projectId,
          name: found.record.resource.name,
        },
      });

      await deleteProxyRoutesByResource(input.resourceId);
      await provisioner.destroy({ serviceName }, log);
      await deleteResourceById(input.resourceId);
      await reconcile(log);

      log.set({
        teardown: { proxyRoutesRemoved: true, swarmDestroyed: true, dbDeleted: true },
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
      await deleteProxyRoutesByResource(input.resourceId);
      await teardownServiceRuntime(found.record.service.serviceName, input, log);
      await deleteResourceById(input.resourceId);
      log.set({
        teardown: { proxyRoutesRemoved: true, runtimeDestroyed: true, dbDeleted: true },
      });
      break;
    }
    case "compose": {
      // Stack deletion is compose.delete's job — it tears down every child
      // service, the swarm stack, routes, and seeded vars. Falling through
      // here would report success without removing anything.
      log.set({ resource: { outcome: "compose_not_deletable_here" } });
      return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
    }
  }

  return Result.ok({ ok: true });
}
