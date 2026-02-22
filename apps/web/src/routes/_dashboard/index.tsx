import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/")({
  beforeLoad: async () => {
    throw redirect({ to: "/projects" });
  },
});
