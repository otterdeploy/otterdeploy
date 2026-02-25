import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: async () => {
    // throw redirect({ to: "/dashboard/projects" });
  },
});
