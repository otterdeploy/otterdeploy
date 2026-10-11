import { createFileRoute } from "@tanstack/react-router";

import { ADD_SERVER_VIEW } from "@/features/servers/add-server/add-server-route";

// The Command tab. The dialog in ./layout.tsx renders it.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/new/command")({
  staticData: { view: ADD_SERVER_VIEW.command },
});
