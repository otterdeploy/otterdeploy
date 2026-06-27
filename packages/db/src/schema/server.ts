import type { ServerId } from "@otterdeploy/shared/id";

// Swarm node (server) registry — one row per host the org has joined to the
// Docker Swarm cluster. Live CPU/mem/disk metrics are NOT stored here; this
// table holds capacity + identity. Runtime stats come from a separate
// metrics path (TBD).
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const serverRoleEnum = pgEnum("server_role", ["manager", "worker"]);
export const serverStatusEnum = pgEnum("server_status", ["ready", "draining", "down"]);
export const serverAvailabilityEnum = pgEnum("server_availability", ["active", "drain", "pause"]);

export const server = pgTable(
  "server",
  {
    id: text("id")
      .primaryKey()
      .$type<ServerId>()
      .$defaultFn(() => createId(ID_PREFIX.server)),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Operator-visible OS hostname (e.g. "Mac", "prod-04.fra"). Shown as a
    // secondary label so `name` can be a stable, friendly identifier like
    // "localhost" while the underlying machine is still surfaced.
    hostname: text("hostname"),
    host: text("host").notNull(),
    // Nullable: the join-command flow doesn't ask the operator for a region;
    // the daemon (or a later edit) fills this in when it has real info.
    region: text("region"),
    role: serverRoleEnum("role").notNull().default("worker"),
    status: serverStatusEnum("status").notNull().default("ready"),
    availability: serverAvailabilityEnum("availability").notNull().default("active"),
    cpuTotal: integer("cpu_total").notNull(),
    memTotalGb: integer("mem_total_gb").notNull(),
    diskTotalGb: integer("disk_total_gb"),
    diskUnit: text("disk_unit").notNull().default("GB"),
    daemonVersion: text("daemon_version"),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("server_organization_id_idx").on(table.organizationId),
    // (org, host) is unique so the localhost-bootstrap insert in
    // listServers can use ON CONFLICT DO NOTHING and stay race-safe.
    uniqueIndex("server_org_host_unique").on(table.organizationId, table.host),
  ],
);
