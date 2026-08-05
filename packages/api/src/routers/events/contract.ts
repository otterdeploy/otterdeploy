import { eventIterator, oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { proxyRouteSchema } from "../project/contract";

const projectIdField = zId(ID_PREFIX.project);
const organizationIdField = zId(ID_PREFIX.organization);
const resourceIdField = zId(ID_PREFIX.resource);
const proxyRouteIdField = zId(ID_PREFIX.proxyRoute);

const projectScopeSchema = z.object({
  organizationId: organizationIdField,
  projectId: projectIdField,
  resourceId: resourceIdField.optional(),
});

const proxyRouteEventRowSchema = proxyRouteSchema.extend({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  dnsCheckedAt: z.coerce.date().nullable(),
  certCheckedAt: z.coerce.date().nullable(),
  domainVerifiedAt: z.coerce.date().nullable(),
});

const resyncCollectionSchema = z.enum([
  "resources",
  "deployments",
  "deployment-tasks",
  "service-tasks",
  "dependencies",
]);

export const collectionEventSchema = z.discriminatedUnion("op", [
  z.object({
    protocol: z.literal(1),
    collection: z.literal("proxy-routes"),
    scope: projectScopeSchema,
    op: z.literal("upsert"),
    rows: z.array(proxyRouteEventRowSchema),
  }),
  z.object({
    protocol: z.literal(1),
    collection: z.literal("proxy-routes"),
    scope: projectScopeSchema,
    op: z.literal("delete"),
    keys: z.array(proxyRouteIdField),
  }),
  z.object({
    protocol: z.literal(1),
    collection: resyncCollectionSchema,
    scope: projectScopeSchema,
    op: z.literal("resync"),
  }),
]);

export type CollectionEvent = z.infer<typeof collectionEventSchema>;

const eventsStreamInputSchema = z.object({
  projectId: projectIdField,
});

export const eventsContract = {
  stream: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found",
      },
    })
    .meta({
      path: "/events",
      tag: "events",
      method: "GET",
    })
    .input(eventsStreamInputSchema)
    .output(eventIterator(collectionEventSchema)),
};
