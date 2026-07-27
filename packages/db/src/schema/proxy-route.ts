import type { PreviewId, ProjectId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";
import type { RoutePolicy } from "@otterdeploy/shared/route-policy";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { DEFAULT_ROUTE_POLICY } from "@otterdeploy/shared/route-policy";
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

import { preview, project } from "./project";

export const proxyRouteTypeEnum = pgEnum("proxy_route_type", ["http", "layer4"]);
export const proxyRouteProtocolEnum = pgEnum("proxy_route_protocol", ["tcp", "http"]);
// Where a route's domain came from. "generated" = the auto-resolved
// hostname minted on expose (resource override → project → org → sslip
// chain). "custom" = a domain the operator typed in themselves.
export const proxyRouteSourceEnum = pgEnum("proxy_route_source", ["generated", "custom"]);

// Which network a route is served on. "public" is the internet-facing Caddy
// listener — today's behavior, and the default for every existing and new row,
// so this column is a no-op until an org opts in. "private" renders ONLY into
// the mesh-bound listener (reachable from the org's own VPN, never from the
// internet); "both" renders into each.
//
// Deliberately NOT a boolean: "private" has to be able to mean *instead of*
// public, or "make this app internal only" isn't expressible.
// Design: docs/designs/vpn-mesh.md
export const proxyRouteExposureScopeEnum = pgEnum("proxy_route_exposure_scope", [
  "public",
  "private",
  "both",
]);

// Reachability of a custom domain, refreshed by the DNS check (on add /
// recheck / edit). Drives the UI status chip and the ACME decision —
// "pointed" earns a real Let's Encrypt cert; "proxied" (resolves into a
// Cloudflare IP range) stays on `tls internal` because Cloudflare
// terminates TLS at its edge; "unpointed"/"unknown" also stay self-signed
// until the operator points DNS at us. Generated routes are "pointed" by
// construction.
export const proxyRouteDnsStateEnum = pgEnum("proxy_route_dns_state", [
  "pointed",
  "proxied",
  "unpointed",
  "unknown",
]);

// TLS certificate lifecycle for the route's domain, promoted from Caddy's
// operational log plane (the global `log { output net }` event stream — see
// edge-logs/ingest.ts). "obtaining" = ACME issuance/renewal in flight;
// "valid" = a cert was obtained/renewed successfully; "failed" = the last
// issuance attempt errored (challenge failure, rate limit, …); "unknown" =
// nothing observed yet (the default — also the steady state for `tls internal`
// self-signed routes, which never emit ACME events).
export const proxyRouteCertStateEnum = pgEnum("proxy_route_cert_state", [
  "unknown",
  "obtaining",
  "valid",
  "failed",
]);

export const proxyRoute = pgTable(
  "proxy_route",
  {
    id: text("id")
      .primaryKey()
      .$type<ProxyRouteId>()
      .$defaultFn(() => createId(ID_PREFIX.proxyRoute)),
    projectId: text("project_id")
      .notNull()
      .$type<ProjectId>()
      .references(() => project.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").$type<ResourceId>(),
    // Set only on preview-scoped routes (PR preview hosts like
    // `web-pr-13-<project>.<base>`). Null = the resource's base route, which
    // every existing domain-management flow reads. Cascade wipes preview
    // routes with their preview row even if teardown missed them.
    previewId: text("preview_id")
      .$type<PreviewId>()
      .references(() => preview.id, { onDelete: "cascade" }),
    type: proxyRouteTypeEnum("type").notNull(),
    domain: text("domain").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull(),
    protocol: proxyRouteProtocolEnum("protocol").notNull(),
    layer4Alpn: text("layer4_alpn"),
    // A resource can carry several routes (one per host). `enabled` gates
    // whether reconcile renders it into the Caddyfile at all — generated
    // routes are enabled on expose; custom routes stay disabled until DNS
    // verification passes (and flip back to disabled on unexpose).
    enabled: boolean("enabled").notNull().default(true),
    // Which network serves this route (see the enum above). Defaults to
    // "public" so every pre-existing row and every org without a connected
    // mesh behaves exactly as it does today.
    exposureScope: proxyRouteExposureScopeEnum("exposure_scope").notNull().default("public"),
    // "generated" (auto-resolved on expose) vs "custom" (operator-typed,
    // gated behind DNS verification). Drives both the UI badge and whether
    // a verify token is expected.
    source: proxyRouteSourceEnum("source").notNull().default("generated"),
    // The canonical host for the resource — mirrored into
    // serviceResource.publicDomain so the panel/graph/views keep reading a
    // single string. Exactly one route per resource carries this flag.
    isPrimary: boolean("is_primary").notNull().default(false),
    // Last observed reachability of a custom domain (add-and-go model — the
    // host is live immediately; this just reflects whether DNS points here
    // yet and drives the ACME decision). Refreshed on add / recheck / edit.
    dnsState: proxyRouteDnsStateEnum("dns_state").notNull().default("unknown"),
    // When the reachability above was last refreshed (for "checked 2m ago").
    dnsCheckedAt: timestamp("dns_checked_at"),
    // TLS cert lifecycle, promoted from Caddy's ACME/cert log events by
    // edge-logs/ingest.ts (best-effort). Drives the domains-card cert badge.
    certState: proxyRouteCertStateEnum("cert_state").notNull().default("unknown"),
    // Last cert-issuance error message (when certState = "failed").
    certError: text("cert_error"),
    // When a cert event last touched this row.
    certCheckedAt: timestamp("cert_checked_at"),
    // Whether Caddy should issue a public ACME cert (Let's Encrypt) for
    // this domain. False = `tls internal` (self-signed) — used for sslip
    // fallback domains and any verified-but-unowned platform default.
    // Set at insert time from the resolver outcome (`resolved.verified &&
    // !sslip`). Stays in sync on subsequent verification changes via the
    // setBaseDomain / verify flows that rewrite routes for the org.
    usesAcme: boolean("uses_acme").notNull().default(false),
    // Deployment protection (Vercel-Authentication-style auth wall). When
    // true, buildHttpBlock wraps the route in a forward_auth gate plus an
    // ungated reserved-path handle for the cross-domain auth handoff. The
    // authorizing org is derived from projectId → project.organizationId.
    // See docs/designs/deployment-protection.md.
    protected: boolean("protected").notNull().default(false),
    // Allowlisted edge behavior rendered by trusted builder code. Unlike the
    // former custom_directives text escape hatch, this cannot introduce
    // handlers, upstreams, paths, filesystem access, or global options.
    routePolicy: jsonb("route_policy").$type<RoutePolicy>().notNull().default(DEFAULT_ROUTE_POLICY),
    // Optional access PIN for the auth wall (NetBird-style): an argon2 hash
    // of a short numeric code anyone can enter on the wall page — no org
    // account or email invite needed. Null = the PIN method is off. Only
    // meaningful while `protected` is true. The plaintext PIN is never
    // stored and never leaves the set mutation; the route contract omits
    // this column so the hash can't reach a client.
    accessPinHash: text("access_pin_hash"),
    // TXT ownership proof for custom domains. Custom routes stay disabled
    // until `_otterdeploy.<domain>` contains this token.
    domainVerifyToken: text("domain_verify_token"),
    domainVerifiedAt: timestamp("domain_verified_at"),
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
    index("proxy_route_preview_id_idx").on(table.previewId),
  ],
);
