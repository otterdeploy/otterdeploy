/**
 * The Edge page's URL: which plane is open, and the Events table's controls.
 *
 * Split out of `edge.tsx` when the Events pane moved onto the shared table
 * shell — the route file was already at the 250-line limit, and this half is
 * the part that has nothing to do with rendering.
 */

import * as z from "zod";

import {
  filterParam,
  tableSearchSchema,
} from "@/shared/components/data-table/state/search-schema";

/** Top-level planes. `caddy` groups the proxy's own facets (config / events /
 *  certs) behind a left sidebar; access logs land first because that's what
 *  people open this page for. */
export const EDGE_TABS = ["logs", "caddy", "firewall"] as const;
export type EdgeTab = (typeof EDGE_TABS)[number];

/** Sidebar panes inside the Caddy tab. */
export const CADDY_PANES = ["config", "events", "certs"] as const;
export type CaddyPane = (typeof CADDY_PANES)[number];

export function isEdgeTab(value: string): value is EdgeTab {
  return EDGE_TABS.some((tab) => tab === value);
}

// `.catch` covers both a missing param and a bad value → default to Access
// logs. The two legacy values kept the old flat-tab deep links working:
// `caddyfile` and `certificates` were top-level tabs before the Caddy group
// existed (and `caddy` used to mean the Events plane; it now opens the group,
// which still contains Events one click away).
const EDGE_SEARCH_TABS = ["logs", "caddy", "firewall", "caddyfile", "certificates"] as const;

/**
 * The planes, plus the Events table's own controls.
 *
 * The table params live here rather than on a route of their own because the
 * Events pane is a tab of THIS route, and TanStack validates search per route.
 * They are safe to share with the panes beside them: `setTab`/`setPane` below
 * replace the whole search object, so leaving Events drops its filters instead
 * of carrying keys into a table that does not have them.
 *
 * Spread from `tableSearchSchema` rather than declared as a catchall: a derived
 * shape erases its keys, and TanStack merges route search types, so one such
 * route would make `navigate` untyped everywhere else in the app.
 */
export const zEdgeSearch = z.object({
  tab: z.enum(EDGE_SEARCH_TABS).catch("logs"),
  pane: z.enum(CADDY_PANES).optional().catch(undefined),
  ...tableSearchSchema({
    // Shared by both tables on this route: `ts` is a timerange on each, `q` a
    // text box on each. Everything else is one table's or the other's, and
    // `setTab` / `setPane` replace the whole bag on the way out, so leaving a
    // pane drops its filters rather than carrying them somewhere they mean
    // nothing.
    ts: filterParam.timerange(),
    q: filterParam.text(),
    // Caddy events.
    level: filterParam.checkbox(),
    category: filterParam.checkbox(),
    hosts: filterParam.checkbox(),
    logger: filterParam.checkbox(),
    // Access logs.
    method: filterParam.checkbox(),
    status: filterParam.checkbox(),
    statusClass: filterParam.checkbox(),
    host: filterParam.checkbox(),
    clientIp: filterParam.checkbox(),
    country: filterParam.checkbox(),
    upstream: filterParam.checkbox(),
    cache: filterParam.checkbox(),
    latencyMs: filterParam.range(),
    suspicious: filterParam.checkbox(),
  }).shape,
});

/** Fold legacy tab values + permissions into a concrete (tab, pane) pair.
 *  Install-admin-only planes (firewall, the rendered Caddyfile) fall back for
 *  everyone else, so a shared deep link never renders a 403 shell. */
export function resolveEdgeView(
  search: z.infer<typeof zEdgeSearch>,
  isInstallAdmin: boolean,
): { tab: EdgeTab; pane: CaddyPane } {
  let tab: EdgeTab;
  let pane = search.pane;
  if (search.tab === "caddyfile") {
    tab = "caddy";
    pane ??= "config";
  } else if (search.tab === "certificates") {
    tab = "caddy";
    pane ??= "certs";
  } else {
    tab = search.tab;
  }
  if (!isInstallAdmin && tab === "firewall") tab = "logs";
  pane ??= isInstallAdmin ? "config" : "events";
  if (!isInstallAdmin && pane === "config") pane = "events";
  return { tab, pane };
}
