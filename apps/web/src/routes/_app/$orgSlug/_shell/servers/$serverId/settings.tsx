import { createFileRoute } from "@tanstack/react-router";

// A server tab. ./layout.tsx renders the page and reads which tab this is.
// Nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/settings")({
  staticData: { view: ["settings"] },
});
