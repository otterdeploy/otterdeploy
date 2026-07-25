import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Servers as the "Install health" tab (od-u63.4) — deploy
// counters + job-queue table are install-wide health, same neighborhood as
// the server fleet. Shim only — keeps old links and bookmarks working.
export const Route = createFileRoute("/_app/$orgSlug/_shell/platform")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/servers",
      params: { orgSlug: params.orgSlug },
      search: { tab: "install-health" },
    });
  },
});
