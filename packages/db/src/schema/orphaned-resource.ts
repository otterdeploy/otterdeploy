import type { OrganizationId, OrphanedResourceId, ProjectId, ServerId } from "@otterdeploy/shared/id";

/**
 * Orphaned runtime resources awaiting garbage collection.
 *
 * A row is written when a resource is deleted but its remote runtime object
 * (swarm service, container, volume, network, built image, compose stack)
 * could NOT be destroyed at delete time — the Docker daemon was unreachable or
 * the destroy call failed. The DB row is the source of truth and is removed
 * regardless (the user must not be blocked by a stopped daemon), so the leaked
 * object is recorded here instead of being silently abandoned. A periodic GC
 * sweep (packages/api/src/system-health/orphan-gc.ts) retries the real teardown
 * primitive idempotently; on success it deletes this row, on failure it bumps
 * `attempts`/`lastAttemptAt` for a later pass.
 *
 * `serverId` is intentionally NOT a FK: removing a server must not cascade-drop
 * the record (we still want the row so GC can confirm/skip it), and a vanished
 * server is handled by the sweep dropping the orphan itself. `projectId` is
 * likewise FK-less — the project is usually already gone; it's forensics/UI only.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";

// What kind of runtime object leaked — selects which teardown primitive the GC
// sweep calls. `service` covers both swarm services and plain-docker containers
// (RuntimeDriver.destroy dispatches by mode); `compose_stack` fans out to its
// child services.
export const orphanedResourceTypeEnum = pgEnum("orphaned_resource_type", [
  "service",
  "volume",
  "network",
  "image",
  "compose_stack",
]);

export const orphanedResource = pgTable(
  "orphaned_resource",
  {
    id: text("id")
      .primaryKey()
      .$type<OrphanedResourceId>()
      .$defaultFn(() => createId(ID_PREFIX.orphanedResource)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    // SSH server the object lives on, when known. Null = local/manager daemon.
    // No FK — see table doc.
    serverId: text("server_id").$type<ServerId>(),
    resourceType: orphanedResourceTypeEnum("resource_type").notNull(),
    // The runtime ref the teardown primitive needs (swarm service name, volume
    // name, network/project slug, image repo, compose resource id).
    ref: text("ref").notNull(),
    // Originating project/resource — already deleted, forensics/UI only, no FK.
    projectId: text("project_id").$type<ProjectId>(),
    // Human-readable label carried from the delete site.
    label: text("label"),
    // Extra data a teardown primitive may need (projectId+resourceId for host
    // image reclaim, compose child names, etc.).
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    // GC attempt counter — bumped when a sweep can't yet destroy the object.
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("orphaned_resource_org_created_idx").on(table.organizationId, table.createdAt),
    // GC sweep cursor: oldest-attempted first.
    index("orphaned_resource_last_attempt_idx").on(table.lastAttemptAt),
  ],
);
