import { createFileRoute } from "@tanstack/react-router";

// Containers › Networks. ./layout.tsx renders the panel and reads which
// sub-tab this is. Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/containers/networks")({
  staticData: { view: ["containers", "networks"] },
});
