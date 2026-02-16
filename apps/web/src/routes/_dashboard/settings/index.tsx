import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/settings/")({
  beforeLoad: () => {
    redirect({ to: "/settings/servers", throw: true });
  },
});
