import type { ServerId, SshKeyId } from "@otterdeploy/shared/id";

// Swarm node (server) registry — one row per host the org has joined to the
// Docker Swarm cluster. Live CPU/mem/disk metrics are NOT stored here; this
// table holds capacity + identity. Runtime stats come from a separate
// metrics path (TBD).
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import {
  boolean,
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
import { sshKey } from "./ssh-key";

export const serverRoleEnum = pgEnum("server_role", ["manager", "worker"]);
export const serverStatusEnum = pgEnum("server_status", ["ready", "draining", "down"]);
export const serverAvailabilityEnum = pgEnum("server_availability", ["active", "drain", "pause"]);
// SSH-onboarding lifecycle — distinct from `status` (a swarm concept). Tracks
// the provision+join run: pending (row created, not started) → provisioning
// (installing Docker) → joining (running `docker swarm join`) → ready (node
// verified in `docker node ls`) | failed (see provisionError). The bootstrap
// localhost row is `ready` from birth. Design: docs/designs/server-onboarding.md
export const serverProvisionStatusEnum = pgEnum("server_provision_status", [
  "pending",
  "provisioning",
  "joining",
  "ready",
  "failed",
]);
// Node interconnect for the swarm. `none` = join over the public/given address
// (the manager must advertise a routable IP). `tailscale`/`netbird` install a
// WireGuard mesh agent during provisioning and use the node's mesh address as
// the swarm advertise/join address — which also sidesteps the loopback
// advertise-address gap. Design: docs/designs/server-onboarding.md
export const serverMeshProviderEnum = pgEnum("server_mesh_provider", [
  "none",
  "tailscale",
  "netbird",
]);

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
    // SSH onboarding (docs/designs/server-onboarding.md). Null on the bootstrap
    // localhost row and on nodes registered by the legacy manual join flow.
    provisionStatus: serverProvisionStatusEnum("provision_status").notNull().default("ready"),
    // Human-readable failure reason when provisionStatus is "failed"; cleared on
    // a successful retry.
    provisionError: text("provision_error"),
    // Which managed key authenticates the SSH provision connection. onDelete set
    // null: deleting the key must not cascade-delete the server row.
    sshKeyId: text("ssh_key_id")
      .$type<SshKeyId>()
      .references(() => sshKey.id, { onDelete: "set null" }),
    // SSH connection details for provisioning. Default root/22 to match the
    // usual fresh-VM posture.
    sshUser: text("ssh_user").notNull().default("root"),
    sshPort: integer("ssh_port").notNull().default(22),
    // Mesh interconnect used for the swarm join (see enum above).
    meshProvider: serverMeshProviderEnum("mesh_provider").notNull().default("none"),
    // The node's mesh address (100.x for tailscale, wt0 IP for netbird), filled
    // in after the mesh agent comes up; also what the swarm advertises/joins on.
    meshAddress: text("mesh_address"),
    // Dedicated build node: labelled `otterdeploy.role=build` in the swarm so
    // build workloads can be placed on it, off the deploy nodes. Image hand-off
    // is via a registry (build here, deploy nodes pull) — see the design doc.
    buildServer: boolean("build_server").notNull().default(false),
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

// Latest host-health snapshot per server — the "separate metrics path" the
// server-table note reserves. One row per server, UPSERTED in place (no
// history; platform_metric keeps local-host series). Written by the health
// agent's ingest route for remote swarm nodes and by the control plane's own
// 60s sampler for the bootstrap localhost row(s). `payload` is the HostHealth
// shape as reported; staleness is judged on receivedAt (our clock — agent
// clocks may skew). Design: docs/designs/server-health-agent.md
export const serverHealthSample = pgTable(
  "server_health_sample",
  {
    serverId: text("server_id")
      .primaryKey()
      .$type<ServerId>()
      .references(() => server.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Hostname as CLAIMED by the reporter — kept for attribution audit even
    // though the row is already matched to a server.
    hostname: text("hostname"),
    payload: jsonb("payload").notNull(),
    sampledAt: timestamp("sampled_at").notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [index("server_health_sample_org_idx").on(table.organizationId)],
);
