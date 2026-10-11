import { createFileRoute, redirect } from "@tanstack/react-router";

// `/servers/new` names no method: open the first tab.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/new/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/servers/new/command",
      params: { orgSlug: params.orgSlug },
      replace: true,
    });
  },
});
