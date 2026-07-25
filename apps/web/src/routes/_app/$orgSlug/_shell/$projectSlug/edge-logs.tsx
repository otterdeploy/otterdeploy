import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Logs as the Edge source (od-u63.5) — Runtime | Edge is a
// toggle on one page now, not two tabs. Shim only — keeps old links and
// bookmarks working.
export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/edge-logs")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/$projectSlug/logs",
      params: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
      search: { source: "edge" },
    });
  },
});
