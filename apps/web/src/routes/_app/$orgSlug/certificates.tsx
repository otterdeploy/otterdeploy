import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into Edge as the Certificates tab (od-u63.1). Shim only. Keeps old
// links, bookmarks and in-flight callbacks working.
export const Route = createFileRoute("/_app/$orgSlug/certificates")({
  staticData: { crumb: "Certificates" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/edge",
      params: { orgSlug: params.orgSlug },
      search: { tab: "certificates" },
    });
  },
});
