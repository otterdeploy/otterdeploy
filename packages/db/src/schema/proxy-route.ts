import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId, ID_PREFIX, type Id } from "@otterstack/shared/id";
import { project } from "./project";

export const proxyRouteTypeEnum = pgEnum("proxy_route_type", ["http", "layer4"]);
export const proxyRouteProtocolEnum = pgEnum("proxy_route_protocol", ["tcp", "http"]);

export const proxyRoute = pgTable(
  "proxy_route",
  {
    id: text("id")
      .primaryKey()
      .$type<Id<typeof ID_PREFIX.proxyRoute>>()
      .$defaultFn(() => createId(ID_PREFIX.proxyRoute)),
    projectId: text("project_id")
      .notNull()
      .$type<Id<typeof ID_PREFIX.project>>()
      .references(() => project.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").$type<Id<typeof ID_PREFIX.resource>>(),
    type: proxyRouteTypeEnum("type").notNull(),
    domain: text("domain").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull(),
    protocol: proxyRouteProtocolEnum("protocol").notNull(),
    layer4Alpn: text("layer4_alpn"),
    enabled: boolean("enabled").notNull().default(true),
    // Whether Caddy should issue a public ACME cert (Let's Encrypt) for
    // this domain. False = `tls internal` (self-signed) — used for sslip
    // fallback domains and any verified-but-unowned platform default.
    // Set at insert time from the resolver outcome (`resolved.verified &&
    // !sslip`). Stays in sync on subsequent verification changes via the
    // setBaseDomain / verify flows that rewrite routes for the org.
    usesAcme: boolean("uses_acme").notNull().default(false),
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
