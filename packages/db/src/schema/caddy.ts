import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId, ID_PREFIX } from "@otterstack/shared/id";

export const projectCaddyConfigStatusEnum = pgEnum("caddy_config_status", [
  "draft",
  "valid",
  "invalid",
]);

export const projectCaddyConfig = pgTable(
  "caddy_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.caddyConfig)),
    projectId: text("project_id").notNull(),
    environmentId: text("environment_id"),
    httpCaddyfile: text("http_caddyfile").notNull().default(""),
    layer4Caddyfile: text("layer4_caddyfile").notNull().default(""),
    appliedHttpCaddyfile: text("applied_http_caddyfile").notNull().default(""),
    appliedLayer4Caddyfile: text("applied_layer4_caddyfile").notNull().default(""),
    status: projectCaddyConfigStatusEnum("status").notNull().default("draft"),
    lastAppliedRevision: text("last_applied_revision"),
    lastAppliedAt: timestamp("last_applied_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("caddy_config_project_id_unique").on(table.projectId),
    index("caddy_config_project_id_idx").on(table.projectId),
  ],
);
