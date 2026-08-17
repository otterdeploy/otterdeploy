import { createFileRoute, redirect } from "@tanstack/react-router";

// Older alias for the GitHub App detail page. Shim only: points straight at
// the current location rather than hopping through the settings shim, so a
// stale link costs one redirect instead of two.
export const Route = createFileRoute("/_app/$orgSlug/git-providers/$providerId")({
  staticData: { crumb: "Git provider" },
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/github-app/$providerId",
      params,
      search: location.search,
    });
  },
});
