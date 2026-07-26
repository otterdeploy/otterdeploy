import { createFileRoute, redirect } from "@tanstack/react-router";

import { zEdgeLogsSearch } from "@/features/edge-logs/data/edge-search";

// Merged into Edge as the Access logs / Events / Firewall tabs (od-u63.1).
// Shim only — the old `logs` / `caddy` / `firewall` tab values are reused
// verbatim by the new route's search schema, so a deep link to a specific
// plane keeps landing on the right tab.
export const Route = createFileRoute("/_app/$orgSlug/_shell/edge-logs")({
  staticData: { crumb: "Edge logs" },
  validateSearch: zEdgeLogsSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/$orgSlug/edge",
      params: { orgSlug: params.orgSlug },
      search: { tab: search.tab },
    });
  },
});
