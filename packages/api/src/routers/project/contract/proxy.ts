/**
 * Caddy proxy-route schemas + slice. One row per layer-4 / HTTP route
 * the caddy reconciler maintains. `resourceId` is nullable so cluster-
 * wide routes (admin endpoints, etc.) can exist without a resource owner.
 */

import { oc } from "@orpc/contract";
import { createSelectSchema } from "drizzle-zod";
import * as z from "zod";

import { proxyRoute } from "@otterdeploy/db/schema";
import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField, proxyRouteIdField, resourceIdField } from "./shared";

export const reconcileResultSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(
    z.object({
      projectId: z.string(),
      error: z.string(),
    }),
  ),
  revision: z.string(),
  loadError: z.string().optional(),
});

export const proxyRouteSchema = createSelectSchema(proxyRoute).extend({
  id: proxyRouteIdField,
  projectId: projectIdField,
  resourceId: resourceIdField.nullable(),
});

export const listProxyRoutesInput = z.object({
  projectId: projectIdField,
});

export const proxyContractSlice = {
  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/proxy-routes`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(z.array(proxyRouteSchema)),
};
