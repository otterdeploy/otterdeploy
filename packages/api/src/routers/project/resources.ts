/**
 * Generic resource read/delete orchestration. Engine-specific create lives in
 * postgres.ts (and future siblings). Read/delete dispatch through the
 * DatabaseProvisioner factory so each engine plugs its own destroy semantics.
 */

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import type { Id, ID_PREFIX as IDP } from "@otterstack/shared/id";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";

import {
  PostgresResourceNotFoundError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import type { ResourceId } from "../service/errors";

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
  sanitizeProjectSlug,
  type PostgresResource,
} from "./views";

type OrgId = Id<typeof IDP.organization>;

type ProjectRef = {
  projectId: ProjectId;
  organizationId: OrgId;
};

type ResourceRef = ProjectRef & {
  resourceId: ResourceId;
};

export type ProjectResource = PostgresResource; // union grows with new engines

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

  const { databases } = await listProjectResourcesQuery(input.projectId);
  const databaseViews = await Promise.all(
    databases.map((record) => mapDatabaseResource(record, project.slug)),
  );

  return Result.ok([...databaseViews]);
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

  // Today there's only `database`; switch on `kind` when more land.
  return Result.ok(await mapDatabaseResource(found.record, project.slug));
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

  if (found.kind === "database") {
    const provisioner = getDatabaseProvisioner(found.record.database.engine);
    const serviceName = buildContainerName({
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
  }

  return Result.ok({ ok: true });
}
