// URL-backed tab state for the org-level Edge logs page. Keeping the active tab
// in a search param makes each plane deep-linkable / shareable (e.g. the old
// `/firewall` route redirects straight to `?tab=firewall`).
//
// Param value → visible tab:
//   logs     → Access  (per-request access log)
//   caddy    → Events  (Caddy operational events — cert/ACME, upstream errors)
//   firewall → Firewall (CrowdSec decisions / sources)

import * as z from "zod";

const EDGE_TABS = ["logs", "caddy", "firewall"] as const;
export type EdgeTab = (typeof EDGE_TABS)[number];

export const zEdgeLogsSearch = z.object({
  // `.catch` covers both a missing param and a bad value → default to Access,
  // so the page always has a valid controlled tab without an extra default.
  tab: z.enum(EDGE_TABS).catch("logs"),
});

export type EdgeLogsSearch = z.infer<typeof zEdgeLogsSearch>;
