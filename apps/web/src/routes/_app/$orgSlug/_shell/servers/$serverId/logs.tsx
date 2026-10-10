// Server › Logs: the host journal and systemd units. Coming soon.
import { createFileRoute } from "@tanstack/react-router";

import { ServerLogsTab } from "./-components/server-detail-shell";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/logs")({
  staticData: { view: ["logs"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  if (!p.server) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <ServerLogsTab server={p.server} />
    </div>
  );
}
