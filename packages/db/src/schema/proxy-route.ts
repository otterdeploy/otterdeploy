import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId, ID_PREFIX } from "@otterstack/shared/id";
import { project } from "./project";

export const proxyRouteTypeEnum = pgEnum("proxy_route_type", ["http", "layer4"]);
export const proxyRouteProtocolEnum = pgEnum("proxy_route_protocol", ["tcp", "http"]);

export const proxyRoute = pgTable(
  "proxy_route",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.proxyRoute)),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    resourceId: text("resource_id"),
    type: proxyRouteTypeEnum("type").notNull(),
    domain: text("domain").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull(),
    protocol: proxyRouteProtocolEnum("protocol").notNull(),
    layer4Alpn: text("layer4_alpn"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("proxy_route_domain_unique").on(table.domain),
    index("proxy_route_project_id_idx").on(table.projectId),
    index("proxy_route_resource_id_idx").on(table.resourceId),
  ],
);
