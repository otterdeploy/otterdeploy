import { createFileRoute, redirect } from "@tanstack/react-router";

// The zone has no index page of its own. Land on workspace General
// (the old org Settings page: base domain + Cloudflare).
export const Route = createFileRoute("/_app/$orgSlug/settings/")({
  staticData: { crumb: "Settings" },
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/general",
      params: { orgSlug: params.orgSlug },
    });
  },
});
