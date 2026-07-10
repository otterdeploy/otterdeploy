import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into the settings zone. Shim only — keeps old links, bookmarks and
// in-flight callbacks working; forwards any search params untouched.
export const Route = createFileRoute("/_app/$orgSlug/webhooks")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/webhooks",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
