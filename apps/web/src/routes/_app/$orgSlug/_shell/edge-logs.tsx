import { createFileRoute, redirect } from "@tanstack/react-router";

import { zEdgeLogsSearch } from "@/features/edge-logs/data/edge-search";

// Merged into Edge (od-u63.1). Shim only. The old `caddy` tab value meant the
// Events plane, which now lives inside the Caddy group as its Events pane, so
// that one maps to an explicit pane; `logs` / `firewall` carry over verbatim.
export const Route = createFileRoute("/_app/$orgSlug/_shell/edge-logs")({
  staticData: { crumb: "Edge logs" },
  validateSearch: zEdgeLogsSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/$orgSlug/edge",
      params: { orgSlug: params.orgSlug },
      search:
        search.tab === "caddy"
          ? { tab: "caddy", pane: "events" }
          : { tab: search.tab },
    });
  },
});
