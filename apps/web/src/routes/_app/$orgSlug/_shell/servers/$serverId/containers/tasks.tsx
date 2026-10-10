import { createFileRoute } from "@tanstack/react-router";

// Containers › Tasks. ./layout.tsx renders the panel and reads which
// sub-tab this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/containers/tasks")({
  staticData: { view: ["containers", "tasks"] },
});
