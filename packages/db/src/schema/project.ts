import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId, ID_PREFIX } from "@otterstack/shared/id";

export const projectStatusEnum = pgEnum("project_status", ["draft", "valid", "invalid"]);

export const project = pgTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.project)),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    environmentId: text("environment_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("project_slug_idx").on(table.slug)],
);

const environment = pgTable("environment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId(ID_PREFIX.environment)),

  projectId: text("project_id")
    .notNull()
    .references(() => project.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

// service
// database
const resourceTypeEnum = pgEnum("resource_type", ["database", "service"]);
const resourceStatusEnum = pgEnum("resource_status", ["draft", "valid", "invalid"]);
const resource = pgTable("resource", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId(ID_PREFIX.resource)),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id),
  name: text("name").notNull(),
  type: resourceTypeEnum("type").notNull(),
  status: resourceStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
