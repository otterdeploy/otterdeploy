import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import {
  composeResource,
  databaseResource,
  deployment,
  project,
  resource,
  serviceEnvVar,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { getTableName } from "drizzle-orm";
import * as z from "zod";

import type { ProjectResource } from "./views";

import { cacheApiResponse, invalidateApiResponses } from "../../lib/api-cache-middleware";
import { resourceSchema } from "./contract/resource-schemas";
import { getProjectInOrg, getResourceById, resolveEnvironmentScope } from "./queries";

interface ResourceListInput {
  projectId: ProjectId;
  environmentId?: EnvironmentId;
}

const dependencyTables = [
  project,
  resource,
  databaseResource,
  serviceResource,
  composeResource,
  deployment,
  serviceEnvVar,
].map(getTableName);

/**
 * The resource-list cache is shared by every authorized actor in one effective
 * organization/project/environment scope. A user ID is intentionally absent.
 */
export const resourceListCacheMiddleware = cacheApiResponse<ResourceListInput, ProjectResource[]>({
  endpoint: "project.resource.list",
  version: 1,
  ttlSeconds: 10,
  dependencyTables,
  outputSchema: z.array(resourceSchema),
  scope: async ({ context, input }) => {
    // Authorization must happen before cache lookup. Missing/foreign projects
    // bypass the cache and let the handler return its normal typed NOT_FOUND.
    const projectRecord = await getProjectInOrg({
      organizationId: context.activeOrganizationId,
      projectId: input.projectId,
    });
    if (!projectRecord) return null;

    const environment = resolveEnvironmentScope(projectRecord, input.environmentId);
    if (!environment) return null;

    return [
      context.activeOrganizationId,
      input.projectId,
      environment.environmentId,
      environment.isMain ? 1 : 0,
    ];
  },
});

/**
 * A delete removes the row needed to derive its environment. Resolve the
 * affected list identity before `next()`, but delete/publish only afterward.
 */
export const invalidateResourceListAfterDelete = invalidateApiResponses<{
  projectId: ProjectId;
  resourceId: ResourceId;
}>({
  targets: async ({ context, input }) => {
    const [projectRecord, found] = await Promise.all([
      getProjectInOrg({
        organizationId: context.activeOrganizationId,
        projectId: input.projectId,
      }),
      getResourceById(input.projectId, input.resourceId),
    ]);
    if (!projectRecord || !found) return [];

    const environment = resolveEnvironmentScope(projectRecord, found.record.resource.environmentId);
    if (!environment) return [];

    return [
      {
        endpoint: "project.resource.list",
        version: 1,
        scope: [
          context.activeOrganizationId,
          input.projectId,
          environment.environmentId,
          environment.isMain ? 1 : 0,
        ],
      },
    ];
  },
});
