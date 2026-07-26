import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved out of the settings zone into the operational sidebar (Workspace
// group): these keys are what deployments authenticate Git pulls and reach
// swarm nodes with. Shim only — keeps old links and bookmarks working.
export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/ssh-keys")({
  staticData: { crumb: "SSH keys" },
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/ssh-keys",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
