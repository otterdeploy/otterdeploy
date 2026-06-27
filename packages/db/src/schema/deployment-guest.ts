import type { DeploymentGuestId, ProxyRouteId } from "@otterdeploy/shared/id";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { proxyRoute } from "./proxy-route";

/**
 * External guests invited to a protected deployment (Cloudflare-Access-style
 * one-time-PIN access). An invited email gets a time-boxed, deployment-scoped
 * session via email OTP — no org account, no invite link. The session length
 * is per-guest (`sessionHours`, default 24). See
 * docs/designs/deployment-protection.md.
 */
export const deploymentGuest = pgTable(
  "deployment_guest",
  {
    id: text("id")
      .primaryKey()
      .$type<DeploymentGuestId>()
      .$defaultFn(() => createId(ID_PREFIX.deploymentGuest)),
    proxyRouteId: text("proxy_route_id")
      .notNull()
      .$type<ProxyRouteId>()
      .references(() => proxyRoute.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** How long the guest's session lasts after a successful OTP, in hours. */
    sessionHours: integer("session_hours").notNull().default(24),
    invitedByUserId: text("invited_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("deployment_guest_route_email_unique").on(t.proxyRouteId, t.email),
    index("deployment_guest_route_idx").on(t.proxyRouteId),
  ],
);
