import type { DatabaseEphemeralCredentialId, ResourceId } from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { resource } from "./project";

export type EphemeralDbScope = "read-only" | "read-write";

/**
 * Short-lived database credentials — a real Postgres role minted on demand
 * (e.g. to hand an AI agent a connection URL) that auto-expires. The role is
 * created with `VALID UNTIL <expiresAt>` so Postgres itself refuses new logins
 * after expiry even if the control plane is down; the sweeper then terminates
 * any lingering sessions and drops the role. The password is NEVER stored —
 * the connection URL is shown exactly once at mint time. Rows are kept after
 * revocation as an audit trail of who minted access when.
 */
export const databaseEphemeralCredential = pgTable(
  "database_ephemeral_credential",
  {
    id: text("id")
      .primaryKey()
      .$type<DatabaseEphemeralCredentialId>()
      .$defaultFn(() => createId(ID_PREFIX.databaseEphemeralCredential)),
    resourceId: text("resource_id")
      .notNull()
      .$type<ResourceId>()
      .references(() => resource.id, { onDelete: "cascade" }),
    /** The Postgres role name (`otter_eph_…`) — needed to drop it later. */
    roleName: text("role_name").notNull(),
    scope: text("scope").$type<EphemeralDbScope>().notNull().default("read-only"),
    /** Optional operator note ("claude data-analysis agent"). */
    label: text("label"),
    expiresAt: timestamp("expires_at").notNull(),
    /** Set when the role has actually been dropped (manual revoke OR sweeper
     *  disposal after expiry). NULL = the role still exists in the database. */
    revokedAt: timestamp("revoked_at"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("database_ephemeral_credential_role_unique").on(t.roleName),
    index("database_ephemeral_credential_resource_idx").on(t.resourceId),
    // The sweeper's scan: active credentials past their expiry.
    index("database_ephemeral_credential_expires_idx").on(t.expiresAt),
  ],
);
