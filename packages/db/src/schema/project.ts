import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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

export const environment = pgTable("environment", {
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
export const resourceTypeEnum = pgEnum("resource_type", ["database", "service"]);
export const resourceStatusEnum = pgEnum("resource_status", ["draft", "valid", "invalid"]);
export const resource = pgTable("resource", {
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

export const databaseEngineEnum = pgEnum("database_engine", ["postgres"]);

export const databaseResource = pgTable(
  "database_resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .references(() => resource.id, { onDelete: "cascade" }),
    engine: databaseEngineEnum("engine").notNull().default("postgres"),
    databaseName: text("database_name").notNull(),
    username: text("username").notNull(),
    password: text("password").notNull(),
    publicHostname: text("public_hostname").notNull(),
    publicPort: integer("public_port").notNull().default(443),
    publicConnectionString: text("public_connection_string").notNull(),
    internalHostname: text("internal_hostname").notNull(),
    internalPort: integer("internal_port").notNull().default(5432),
    internalConnectionString: text("internal_connection_string").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull().default(5432),
    caddyLayer4Snippet: text("caddy_layer4_snippet").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("database_resource_database_name_unique").on(table.databaseName),
    uniqueIndex("database_resource_username_unique").on(table.username),
    uniqueIndex("database_resource_public_hostname_unique").on(table.publicHostname),
    uniqueIndex("database_resource_internal_hostname_unique").on(table.internalHostname),
  ],
);
