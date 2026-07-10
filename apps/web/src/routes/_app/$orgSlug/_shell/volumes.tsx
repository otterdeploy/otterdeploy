import { createFileRoute, redirect } from "@tanstack/react-router";

// Volumes now live on the Docker page's Volumes tab. Shim only — keeps old
// links and bookmarks working (same pattern as the notifications move).
export const Route = createFileRoute("/_app/$orgSlug/_shell/volumes")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/docker",
      params: { orgSlug: params.orgSlug },
      search: { tab: "volumes" },
    });
  },
});
