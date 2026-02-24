import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { resource } from "./project";
import { secretReference } from "./secrets";
import { serverStatusEnum, serverRoleEnum } from "./enums";

export const sshKey = pgTable(
  "ssh_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    privateKeySecretReferenceId: text("private_key_secret_reference_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("ssh_key_org_idx").on(table.organizationId),
    index("ssh_key_secret_ref_idx").on(table.privateKeySecretReferenceId),
  ],
);

export const server = pgTable(
  "server",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ipAddress: text("ip_address").notNull(),
    port: integer("port").notNull().default(22),
    sshKeyId: text("ssh_key_id").references(() => sshKey.id, {
      onDelete: "set null",
    }),
    status: serverStatusEnum("status").notNull().default("disconnected"),
    role: serverRoleEnum("role").notNull().default("worker"),
    dockerVersion: text("docker_version"),
    os: text("os"),
    arch: text("arch"),
    totalMemory: bigint("total_memory", { mode: "number" }),
    totalCpu: integer("total_cpu"),
    totalDisk: bigint("total_disk", { mode: "number" }),
    swarmNodeId: text("swarm_node_id"),
    baseDomain: text("base_domain"),
    dockerCleanupThreshold: integer("docker_cleanup_threshold").default(80),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("server_org_idx").on(table.organizationId)],
);

export const gitProvider = pgTable(
  "git_provider",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    appId: text("app_id"),
    clientId: text("client_id"),
    clientSecretReferenceId: text("client_secret_reference_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
    installationId: text("installation_id"),
    webhookSecretReferenceId: text("webhook_secret_reference_id").references(
      () => secretReference.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("git_provider_org_idx").on(table.organizationId),
    index("git_provider_client_secret_ref_idx").on(table.clientSecretReferenceId),
    index("git_provider_webhook_secret_ref_idx").on(table.webhookSecretReferenceId),
  ],
);

export const gitRepository = pgTable(
  "git_repository",
  {
    id: text("id").primaryKey(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    gitProviderId: text("git_provider_id")
      .notNull()
      .references(() => gitProvider.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    branch: text("branch").notNull().default("main"),
    rootDirectory: text("root_directory").default("/"),
    autoDeploy: boolean("auto_deploy").notNull().default(true),
    webhookId: text("webhook_id"),
    watchPaths: text("watch_paths").array(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("git_repo_resource_idx").on(table.resourceId)],
);

// --- Relations ---

export const sshKeyRelations = relations(sshKey, ({ one }) => ({
  organization: one(organization, {
    fields: [sshKey.organizationId],
    references: [organization.id],
  }),
}));

export const serverRelations = relations(server, ({ one }) => ({
  organization: one(organization, {
    fields: [server.organizationId],
    references: [organization.id],
  }),
  sshKey: one(sshKey, {
    fields: [server.sshKeyId],
    references: [sshKey.id],
  }),
}));

export const gitProviderRelations = relations(gitProvider, ({ one, many }) => ({
  organization: one(organization, {
    fields: [gitProvider.organizationId],
    references: [organization.id],
  }),
  repositories: many(gitRepository),
}));

export const gitRepositoryRelations = relations(gitRepository, ({ one }) => ({
  resource: one(resource, {
    fields: [gitRepository.resourceId],
    references: [resource.id],
  }),
  provider: one(gitProvider, {
    fields: [gitRepository.gitProviderId],
    references: [gitProvider.id],
  }),
}));
