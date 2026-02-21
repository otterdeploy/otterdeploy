import { defineQueries, defineQuery } from "@rocicorp/zero";
import { zql } from "./schema";
import * as z from "zod";

export const queries = defineQueries({
  projectList: defineQuery(
    z.object({ organizationId: z.string() }),
    ({ args: { organizationId } }) =>
      zql.project
        .where("organizationId", organizationId)
        .where("deletedAt", null),
  ),

  projectById: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) =>
      zql.project.where("id", projectId).one(),
  ),

  environmentList: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) =>
      zql.projectEnvironment.where("projectId", projectId),
  ),

  resourceList: defineQuery(
    z.object({ environmentId: z.string() }),
    ({ args: { environmentId } }) =>
      zql.projectResource.where("environmentId", environmentId),
  ),

  resourceById: defineQuery(
    z.object({ resourceId: z.string() }),
    ({ args: { resourceId } }) =>
      zql.projectResource.where("id", resourceId).one(),
  ),

  resourceLinkList: defineQuery(
    z.object({ environmentId: z.string() }),
    ({ args: { environmentId } }) =>
      zql.projectResourceLink.where("environmentId", environmentId),
  ),

  viewport: defineQuery(
    z.object({ environmentId: z.string() }),
    ({ args: { environmentId } }) =>
      zql.projectViewport.where("environmentId", environmentId).one(),
  ),

  deploymentListForProject: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) =>
      zql.deployment
        .where("projectId", projectId)
        .related("events"),
  ),

  deploymentListForResource: defineQuery(
    z.object({ resourceId: z.string() }),
    ({ args: { resourceId } }) =>
      zql.deployment
        .where("resourceId", resourceId)
        .related("events"),
  ),

  serverList: defineQuery(
    z.object({ organizationId: z.string() }),
    ({ args: { organizationId } }) =>
      zql.server.where("organizationId", organizationId),
  ),
});
