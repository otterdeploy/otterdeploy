import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into the settings zone. Shim only — keeps old links, bookmarks and
// in-flight callbacks working; forwards any search params untouched.
export const Route = createFileRoute("/_app/$orgSlug/registries")({
  staticData: { crumb: "Registries" },
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/registries",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
