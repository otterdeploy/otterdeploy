import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved out of the settings zone into the operational sidebar (Workspace
// group): a registry is something deployments pull from, not something you
// configure once. Shim only — keeps old links and bookmarks working.
export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/registries")({
  staticData: { crumb: "Registries" },
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/registries",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
