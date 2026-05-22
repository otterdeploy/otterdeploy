import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  beforeLoad: async ({ context }) => {
    const workspace = context.workspaces.find((w) => w.active);
    if (!workspace) {
      throw new Error("No active workspace");
    }
    throw redirect({
      to: "/$workspaceId",
      params: { workspaceId: workspace.id },
    });
  },
});
