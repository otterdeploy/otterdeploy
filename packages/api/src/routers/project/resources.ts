/**
 * Generic resource read/delete orchestration. Engine-specific create lives in
 * postgres.ts (and future siblings). Read/delete dispatch through the
 * DatabaseProvisioner factory so each engine plugs its own destroy semantics.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";

import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";

import {
  deleteResourceById,
  getProjectInOrg,
  getResourceById,
  listProjectResources as listProjectResourcesQuery,
} from "./queries";
import { getDatabaseProvisioner } from "./provisioners";
import {
  buildContainerName,
  mapDatabaseResource,
  mapServiceResource,
  sanitizeProjectSlug,
  type ProjectResource,
} from "./views";

type OrgId = OrganizationId;

interface ProjectRef {
  projectId: ProjectId;
  organizationId: OrgId;
}

type ResourceRef = ProjectRef & {
  resourceId: ResourceId;
};

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

  const { databases, services } = await listProjectResourcesQuery(input.projectId);
  const [databaseViews, serviceViews] = await Promise.all([
    Promise.all(databases.map((record) => mapDatabaseResource(record, project.slug))),
    Promise.all(services.map((record) => mapServiceResource(record))),
  ]);

  return Result.ok([...databaseViews, ...serviceViews]);
}

export async function getProjectResource(
  input: ResourceRef,
): Promise<Result<ProjectResource, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  switch (found.kind) {
    case "database":
      return Result.ok(await mapDatabaseResource(found.record, project.slug));
    case "service":
      return Result.ok(await mapServiceResource(found.record));
  }
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
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    log.set({ resource: { outcome: "resource_not_found" } });
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
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
      // No Swarm teardown for services yet — deployment path not wired.
      // The row delete cascades to service_resource + ports + env vars via
      // the schema's onDelete: cascade.
      log.set({
        resource: {
          kind: "service",
          projectId: input.projectId,
          name: found.record.resource.name,
        },
      });
      await deleteProxyRoutesByResource(input.resourceId);
      await deleteResourceById(input.resourceId);
      log.set({ teardown: { proxyRoutesRemoved: true, dbDeleted: true } });
      break;
    }
  }

  return Result.ok({ ok: true });
}
