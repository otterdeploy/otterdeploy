import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into the settings zone. Shim only — keeps old links, bookmarks and
// in-flight callbacks working; forwards any search params untouched.
export const Route = createFileRoute("/_app/$orgSlug/instance")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/settings/instance/general",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
