/**
 * The Edge page's URL: which plane is open, and the Events table's controls.
 *
 * Split out of `edge.tsx` when the Events pane moved onto the shared table
 * shell — the route file was already at the 250-line limit, and this half is
 * the part that has nothing to do with rendering.
 */

import * as z from "zod";

import type { FirewallTab } from "@/features/firewall/tabs";

import type { CertTab } from "./edge-certificates";

import { edgeAccessSearchParams } from "@/features/edge-logs/table/access-search";
import {
  filterParam,
  tableSearchSchema,
} from "@/shared/components/data-table/state/search-schema";

/** Top-level planes. `caddy` groups the proxy's own facets (config / events /
 *  certs) behind a left sidebar; access logs land first because that's what
 *  people open this page for. Each plane and pane is a route: `/edge`,
 *  `/edge/events`, `/edge/certificates[/custom|/cas]`, `/edge/config`,
 *  `/edge/firewall[/flagged|/sources]`. */
export const EDGE_TABS = ["logs", "caddy", "firewall"] as const;
export type EdgeTab = (typeof EDGE_TABS)[number];

/** Sidebar panes inside the Caddy tab. */
export const CADDY_PANES = ["config", "events", "certs"] as const;
export type CaddyPane = (typeof CADDY_PANES)[number];

export function isEdgeTab(value: string): value is EdgeTab {
  return EDGE_TABS.some((tab) => tab === value);
}

/**
 * The two tables' controls (access logs and Caddy events).
 *
 * They live on the edge layout because it renders both tables; the planes
 * themselves are child routes. Switching plane navigates with an empty
 * search, so leaving a table drops its filters instead of carrying keys into
 * a table that does not have them.
 *
 * Spread from `tableSearchSchema` rather than declared as a catchall: a derived
 * shape erases its keys, and TanStack merges route search types, so one such
 * route would make `navigate` untyped everywhere else in the app.
 */
export const zEdgeSearch = z.object({
  ...tableSearchSchema({
    // Access logs, which also brings `ts` — a timerange on both tables.
    ...edgeAccessSearchParams,
    // The table-wide search, meaning the same thing on each.
    q: filterParam.text(),
    // Caddy events. `setTab` / `setPane` replace the whole bag on the way out,
    // so leaving a pane drops its filters rather than carrying keys into a
    // table that does not have them.
    level: filterParam.checkbox(),
    category: filterParam.checkbox(),
    hosts: filterParam.checkbox(),
    logger: filterParam.checkbox(),
  }).shape,
});

/** Fold permissions into a concrete (tab, pane) pair. Install-admin-only
 *  planes (firewall, the rendered Caddyfile) fall back for everyone else, so a
 *  shared deep link never renders a 403 shell. */
export function resolveEdgeView(
  requested: { tab: EdgeTab; pane: CaddyPane | undefined },
  isInstallAdmin: boolean,
): { tab: EdgeTab; pane: CaddyPane } {
  let tab = requested.tab;
  let pane = requested.pane;
  if (!isInstallAdmin && tab === "firewall") tab = "logs";
  pane ??= isInstallAdmin ? "config" : "events";
  if (!isInstallAdmin && pane === "config") pane = "events";
  return { tab, pane };
}

/** Where each plane, pane and sub-tab lives. */
export const EDGE_PATHS = {
  logs: "/$orgSlug/edge",
  events: "/$orgSlug/edge/events",
  config: "/$orgSlug/edge/config",
  certs: "/$orgSlug/edge/certificates",
  firewall: "/$orgSlug/edge/firewall",
} as const;

export const CERT_PATHS = {
  managed: "/$orgSlug/edge/certificates",
  custom: "/$orgSlug/edge/certificates/custom",
  cas: "/$orgSlug/edge/certificates/cas",
} as const satisfies Record<CertTab, string>;

export const FIREWALL_PATHS = {
  blocked: "/$orgSlug/edge/firewall",
  flagged: "/$orgSlug/edge/firewall/flagged",
  sources: "/$orgSlug/edge/firewall/sources",
} as const satisfies Record<FirewallTab, string>;
