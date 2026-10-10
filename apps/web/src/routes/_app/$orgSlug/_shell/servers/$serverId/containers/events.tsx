import { createFileRoute } from "@tanstack/react-router";

// Containers › Events. ./layout.tsx renders the panel and reads which
// sub-tab this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/containers/events")({
  staticData: { view: ["containers", "events"] },
});
