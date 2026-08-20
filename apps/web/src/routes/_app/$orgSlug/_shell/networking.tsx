import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Edge as the Caddy group's Config pane (od-u63.1). Shim only:
// keeps old links and bookmarks working.
export const Route = createFileRoute("/_app/$orgSlug/_shell/networking")({
  staticData: { crumb: "Networking" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/edge",
      params: { orgSlug: params.orgSlug },
      search: { tab: "caddy", pane: "config" },
    });
  },
});
