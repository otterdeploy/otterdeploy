import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved to Settings → Workspace → GitHub App detail. Shim only — forwards the
// provider param and any search untouched.
export const Route = createFileRoute("/_app/$orgSlug/git-providers/$providerId")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/github-app/$providerId",
      params,
      search: location.search,
    });
  },
});
