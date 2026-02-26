import { createId } from "@otterdeploy/utils";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project, environment, resource } from "./project";
import { deploymentStatusEnum, deploymentSourceEnum, builderEnum } from "./enums";

export const deployment = pgTable(
  "deployment",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    status: deploymentStatusEnum("status").notNull().default("queued"),
    source: deploymentSourceEnum("source").notNull().default("manual"),
    gitRef: text("git_ref"),
    gitCommitSha: text("git_commit_sha"),
    gitCommitMessage: text("git_commit_message"),
    builder: builderEnum("builder"),
    imageTag: text("image_tag"),
    previousImageTag: text("previous_image_tag"),
    logPath: text("log_path"),
    logServerId: text("log_server_id"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    finishedAt: timestamp("finished_at"),
    duration: integer("duration"),
    errorMessage: text("error_message"),
    triggeredBy: text("triggered_by").references(() => user.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("deployment_org_idx").on(table.organizationId),
    index("deployment_project_idx").on(table.projectId),
    index("deployment_resource_idx").on(table.resourceId),
    index("deployment_status_idx").on(table.status),
    index("deployment_created_idx").on(table.createdAt),
  ],
);

export const deploymentEvent = pgTable(
  "deployment_event",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployment.id, { onDelete: "cascade" }),
    status: deploymentStatusEnum("status").notNull(),
    previousStatus: deploymentStatusEnum("previous_status"),
    actor: text("actor"),
    reason: text("reason"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("deployment_event_deployment_idx").on(table.deploymentId),
    index("deployment_event_created_idx").on(table.createdAt),
  ],
);

// --- Relations ---

export const deploymentRelations = relations(deployment, ({ one, many }) => ({
  project: one(project, {
    fields: [deployment.projectId],
    references: [project.id],
  }),
  environment: one(environment, {
    fields: [deployment.environmentId],
    references: [environment.id],
  }),
  resource: one(resource, {
    fields: [deployment.resourceId],
    references: [resource.id],
  }),
  triggeredByUser: one(user, {
    fields: [deployment.triggeredBy],
    references: [user.id],
  }),
  events: many(deploymentEvent),
}));

export const deploymentEventRelations = relations(
  deploymentEvent,
  ({ one }) => ({
    deployment: one(deployment, {
      fields: [deploymentEvent.deploymentId],
      references: [deployment.id],
    }),
  }),
);
