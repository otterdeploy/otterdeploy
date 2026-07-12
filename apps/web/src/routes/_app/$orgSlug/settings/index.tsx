import { createFileRoute, redirect } from "@tanstack/react-router";

// The zone has no index page of its own — land on workspace General
// (the old org Settings page: base domain + Cloudflare).
export const Route = createFileRoute("/_app/$orgSlug/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/general",
      params: { orgSlug: params.orgSlug },
    });
  },
});
