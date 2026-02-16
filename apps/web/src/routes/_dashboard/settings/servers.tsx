import { createFileRoute } from "@tanstack/react-router";

import { ServerList } from "@/components/settings/server-list";

export const Route = createFileRoute("/_dashboard/settings/servers")({
  component: ServersPage,
});

function ServersPage() {
  return <ServerList />;
}
