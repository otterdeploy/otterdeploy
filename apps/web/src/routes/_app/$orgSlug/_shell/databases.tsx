import { createFileRoute, redirect } from "@tanstack/react-router";

// Deleted (od-u63.6, superseding od-asc.3's "no third database inventory"
// decision) — the org-wide catalog's unique live stats (connections, data
// size) moved into the Backups page rows, which already tracks per-database
// backup freshness. Shim only — keeps old links and bookmarks working.
export const Route = createFileRoute("/_app/$orgSlug/_shell/databases")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/backups",
      params: { orgSlug: params.orgSlug },
    });
  },
});
