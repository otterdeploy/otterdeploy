import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  beforeLoad: async () => {
    throw redirect({
      to: "/$workspaceId",
      params: { workspaceId: "wksp_ssssss" },
    });
  },
});
