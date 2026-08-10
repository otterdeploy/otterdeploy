import { createFileRoute, redirect } from "@tanstack/react-router";

// Certificates moved out of Settings into Edge (od-u63.1 / od-u63.7). TLS is
// an edge concern, not workspace configuration. Shim only: keeps old links,
// bookmarks and in-flight callbacks working.
export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/certificates")({
  staticData: { crumb: "Certificates" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/edge",
      params: { orgSlug: params.orgSlug },
      search: { tab: "certificates" },
    });
  },
});
