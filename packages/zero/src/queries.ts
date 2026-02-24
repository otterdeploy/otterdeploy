import { defineQueries, defineQuery } from "@rocicorp/zero";
import { zql } from "./schema";
import * as z from "zod";

export const queries = defineQueries({
  project: {
    list: defineQuery(z.object({ organizationId: z.string() }), ({ args: { organizationId } }) =>
      zql.project.where("organizationId", organizationId).where("deletedAt", "IS", null),
    ),

    byId: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
      zql.project.where("id", projectId).one(),
    ),
  },

  environment: {
    list: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
      zql.environment.where("projectId", projectId),
    ),
    byId: defineQuery(z.object({ environmentId: z.string() }), ({ args: { environmentId } }) =>
      zql.environment.where("id", environmentId).one(),
    ),
  },

  resource: {
    list: defineQuery(z.object({ environmentId: z.string() }), ({ args: { environmentId } }) =>
      zql.resource.where("environmentId", environmentId),
    ),

    byId: defineQuery(z.object({ resourceId: z.string() }), ({ args: { resourceId } }) =>
      zql.resource.where("id", resourceId).one(),
    ),
  },

  viewport: defineQuery(z.object({ environmentId: z.string() }), ({ args: { environmentId } }) =>
    zql.viewport.where("environmentId", environmentId).one(),
  ),

  deployment: {
    listForResource: defineQuery(z.object({ resourceId: z.string() }), ({ args: { resourceId } }) =>
      zql.deployment.where("resourceId", resourceId).related("events"),
    ),
    listForProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
      zql.deployment.where("projectId", projectId).related("events"),
    ),
  },
  server: {
    list: defineQuery(z.object({ organizationId: z.string() }), ({ args: { organizationId } }) =>
      zql.server.where("organizationId", organizationId),
    ),
  },
});
