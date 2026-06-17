import { createFileRoute, redirect } from "@tanstack/react-router";

// Firewall moved into the Edge Logs page as a tab (it's an edge-level concern).
// Keep this path as a redirect so old links / bookmarks land in the right place.
export const Route = createFileRoute("/_app/$orgSlug/firewall")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/edge-logs",
      params: { orgSlug: params.orgSlug },
      search: { tab: "firewall" },
    });
  },
});
