/**
 * External database connections the data workbench can browse.
 *
 * The thing people mean by "like Drizzle Studio": point it at a Neon, Supabase,
 * RDS or laptop database that otterdeploy did not provision and does not run.
 * Managed resources need no row here — they are resolved from
 * `database_resource` — so this table is only ever about databases we are a
 * guest of.
 *
 * That distinction drives every decision below.
 */
import type { DataConnectionId, OrganizationId, UserId } from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

/**
 * Engines a connection may target.
 *
 * Narrower than `DatabaseEngine`: only the engines with a wire driver can be
 * connected to at all, and offering the others would be a form that fails on
 * save.
 */
export const dataConnectionEngineEnum = pgEnum("data_connection_engine", ["postgres", "mariadb"]);

/**
 * Who can see the connection.
 *
 * `org` is the default because a shared staging database is the common case and
 * making everyone paste the same URL is how a credential ends up in a Slack
 * thread. `private` exists for the scratch database on someone's laptop, which
 * nobody else can reach anyway.
 */
export const dataConnectionVisibilityEnum = pgEnum("data_connection_visibility", [
  "org",
  "private",
]);

/**
 * How dangerous this connection is assumed to be.
 *
 * `production` forces `read-only` and cannot be silently overridden per query.
 * That is the write gate: rather than asking a second human to approve each
 * edit — which gets rubber-stamped — the deliberate, audited, revocable act is
 * changing what the CONNECTION is allowed to do.
 */
export const dataConnectionEnvironmentEnum = pgEnum("data_connection_environment", [
  "production",
  "other",
]);

export const dataConnectionAccessEnum = pgEnum("data_connection_access", [
  "read-only",
  "read-write",
]);

export const dataConnection = pgTable(
  "data_connection",
  {
    id: text("id")
      .primaryKey()
      .$type<DataConnectionId>()
      .$defaultFn(() => createId(ID_PREFIX.dataConnection)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    engine: dataConnectionEngineEnum("engine").notNull(),

    /**
     * The connection URL, AES-GCM sealed under the `data-connections` domain.
     *
     * Never returned by any procedure. The control plane opens the connection;
     * the browser sends `{ connectionId, … }` and receives rows. A workbench
     * that shipped the URL to the client would be handing every viewer a
     * credential for a database we cannot rotate.
     */
    encryptedUrl: text("encrypted_url").notNull(),
    /**
     * Host and database name, parsed out of the URL at save time.
     *
     * Stored separately so the connection list can say WHICH database a row
     * points at without decrypting anything, and so a stale row is
     * identifiable after the credential stops working.
     */
    displayHost: text("display_host").notNull(),
    displayDatabase: text("display_database").notNull(),

    visibility: dataConnectionVisibilityEnum("visibility").notNull().default("org"),
    environment: dataConnectionEnvironmentEnum("environment").notNull().default("other"),
    /** Ignored while `environment = 'production'`, which pins read-only. */
    defaultAccess: dataConnectionAccessEnum("default_access").notNull().default("read-only"),
    /** Require TLS. Default on: an external hop is over the public internet. */
    requireTls: boolean("require_tls").notNull().default(true),
    /**
     * Free-form labels for finding a connection: "analytics", "customer-acme".
     *
     * Canonicalised at save time by `@otterdeploy/shared/data-tags` (lowercase,
     * deduplicated, capped), so equality here is string equality. A jsonb
     * array like `server.labels`: read as a whole, never queried by element.
     */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),

    createdBy: text("created_by")
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    /** Last successful connect, so a dead row is visible without opening it. */
    lastConnectedAt: timestamp("last_connected_at"),
  },
  (table) => [
    index("data_connection_org_idx").on(table.organizationId),
    index("data_connection_creator_idx").on(table.createdBy),
  ],
);
