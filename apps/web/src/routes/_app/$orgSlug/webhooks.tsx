import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into the settings zone. Shim only. Keeps old links, bookmarks and
// in-flight callbacks working; forwards any search params untouched.
export const Route = createFileRoute("/_app/$orgSlug/webhooks")({
  staticData: { crumb: "Webhooks" },
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/webhooks",
      params: { orgSlug: params.orgSlug },
      search: location.search,
    });
  },
});
