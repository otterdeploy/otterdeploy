import { createId } from "@otterdeploy/utils";
import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { environment, resource } from "./project";

export const networkPolicy = pgTable(
  "network_policy",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("network_policy_env_idx").on(table.environmentId),
    uniqueIndex("network_policy_env_name_uidx").on(table.environmentId, table.name),
  ],
);

export const networkPolicyMember = pgTable(
  "network_policy_member",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    networkPolicyId: text("network_policy_id")
      .notNull()
      .references(() => networkPolicy.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    alias: text("alias"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("network_policy_member_policy_idx").on(table.networkPolicyId),
    index("network_policy_member_resource_idx").on(table.resourceId),
    uniqueIndex("network_policy_member_policy_resource_uidx").on(
      table.networkPolicyId,
      table.resourceId,
    ),
  ],
);

// --- Relations ---

export const networkPolicyRelations = relations(networkPolicy, ({ one, many }) => ({
  environment: one(environment, {
    fields: [networkPolicy.environmentId],
    references: [environment.id],
  }),
  members: many(networkPolicyMember),
}));

export const networkPolicyMemberRelations = relations(networkPolicyMember, ({ one }) => ({
  networkPolicy: one(networkPolicy, {
    fields: [networkPolicyMember.networkPolicyId],
    references: [networkPolicy.id],
  }),
  resource: one(resource, {
    fields: [networkPolicyMember.resourceId],
    references: [resource.id],
  }),
}));
