import { bigint, jsonb, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Moving an existing plain-Docker install's workloads onto otterd without
 * restarting them. One session at a time; each resource moves through a
 * journalled sequence (before-image, restart policy off, adoption, owner
 * switch) and can be given back until the session is finalized.
 */
export const otterdMigrationSession = pgTable("otterd_migration_session", {
  sessionId: text("session_id").primaryKey(),
  /** open | finalizing | finalized | closed */
  state: text("state").notNull(),
  openedBy: text("opened_by").notNull(),
  openedAt: bigint("opened_at", { mode: "number" }).notNull(),
  finalizedAt: bigint("finalized_at", { mode: "number" }),
});

/** The container's state before migration touched it: what rollback restores. */
export interface BeforeImage {
  containerId: string;
  name: string;
  image: string;
  restartPolicy: { name: string; maximumRetryCount?: number };
  pid: number;
  startedAt: string;
  networks: string[];
  ports: string[];
  mounts: { type: string; source: string; target: string }[];
}

/**
 * One resource's migration. `state` moves held → restart-disabled →
 * adopt-requested → adopted → migrated, or back through release-requested →
 * released → rolled-back; `failed` keeps the error and stays held.
 */
export const otterdMigrationResource = pgTable("otterd_migration_resource", {
  resourceId: text("resource_id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => otterdMigrationSession.sessionId),
  state: text("state").notNull(),
  nodeId: text("node_id"),
  serviceName: text("service_name"),
  containerId: text("container_id"),
  beforeImage: jsonb("before_image").$type<BeforeImage>(),
  grantId: text("grant_id"),
  error: text("error"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
