import { createFileRoute, redirect } from "@tanstack/react-router";

// Volumes now live on the Servers page's Raw Docker → Volumes tab. Shim
// only: keeps old links and bookmarks working (same pattern as the
// notifications move).
export const Route = createFileRoute("/_app/$orgSlug/_shell/volumes")({
  staticData: { crumb: "Volumes" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/servers",
      params: { orgSlug: params.orgSlug },
      search: { tab: "docker", dockerTab: "volumes" },
    });
  },
});
