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
  "manifest",
  "previews",
]);

const collectionEventSchema = z.discriminatedUnion("op", [
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

const orgScopeSchema = z.object({ organizationId: organizationIdField });

/**
 * A connection row as pushed to the client.
 *
 * Everything needed to identify the connection and nothing that could open it:
 * the encrypted URL is not here, is not on `data.listConnections`, and must
 * never be added to either.
 */
const dataConnectionEventRowSchema = z.object({
  id: zId(ID_PREFIX.dataConnection),
  name: z.string(),
  engine: z.enum(["postgres", "mariadb"]),
  displayHost: z.string(),
  displayDatabase: z.string(),
  visibility: z.enum(["org", "private"]),
  environment: z.enum(["production", "other"]),
  defaultAccess: z.enum(["read-only", "read-write"]),
  requireTls: z.boolean(),
  createdAt: z.coerce.date(),
  lastConnectedAt: z.coerce.date().nullable(),
});

/**
 * Org-wide stream events.
 *
 * Two shapes, per docs/designs/collection-cache-invalidation-api.md: `resync`
 * names a surface and the client refetches; `upsert`/`delete` carry the row and
 * the client applies it with `writeUpsert`/`writeDelete` without refetching at
 * all. See @otterdeploy/shared/org-events for the bus side.
 */
const orgCollectionEventSchema = z.discriminatedUnion("op", [
  z.object({
    protocol: z.literal(1),
    collection: z.enum(["activity", "inbox", "servers"]),
    scope: orgScopeSchema,
    op: z.literal("resync"),
  }),
  z.object({
    protocol: z.literal(1),
    collection: z.literal("data-connections"),
    scope: orgScopeSchema,
    op: z.literal("upsert"),
    rows: z.array(dataConnectionEventRowSchema),
  }),
  z.object({
    protocol: z.literal(1),
    collection: z.literal("data-connections"),
    scope: orgScopeSchema,
    op: z.literal("delete"),
    keys: z.array(zId(ID_PREFIX.dataConnection)),
  }),
]);

export type OrgCollectionEvent = z.infer<typeof orgCollectionEventSchema>;

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

  orgStream: oc
    .errors({
      FORBIDDEN: {
        status: 403,
        message: "Project-scoped API keys cannot subscribe to organization-wide streams",
      },
    })
    .meta({
      path: "/events/org",
      tag: "events",
      method: "GET",
    })
    .input(z.object({}))
    .output(eventIterator(orgCollectionEventSchema)),
};
