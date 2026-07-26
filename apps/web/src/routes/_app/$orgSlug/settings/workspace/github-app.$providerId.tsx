import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved out of the settings zone alongside Git providers. Shim only — forwards
// the provider param and any search untouched.
export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/github-app/$providerId")({
  staticData: { crumb: "GitHub app" },
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/github-app/$providerId",
      params,
      search: location.search,
    });
  },
});
