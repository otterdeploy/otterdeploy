import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into the settings zone. Shim only — keeps old links, bookmarks and
// in-flight callbacks working; forwards any search params untouched.
export const Route = createFileRoute("/_app/$orgSlug/account")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/settings/account/profile",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
