import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into Edge as the Caddyfile tab (od-u63.1). Shim only — keeps old
// links and bookmarks working; the default `tab` on /edge is already
// "caddyfile", so no search param is needed.
export const Route = createFileRoute("/_app/$orgSlug/_shell/networking")({
  staticData: { crumb: "Networking" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/edge",
      params: { orgSlug: params.orgSlug },
      search: { tab: "caddyfile" },
    });
  },
});
