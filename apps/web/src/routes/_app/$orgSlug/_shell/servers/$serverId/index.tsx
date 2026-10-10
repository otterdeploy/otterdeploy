// Server › Overview: is this box healthy, and the machine's facts.
import { createFileRoute } from "@tanstack/react-router";

import { ServerOverviewTab } from "./-components/server-detail-overview";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/")({
  staticData: { view: ["overview"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  if (!p.server || !p.state) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <ServerOverviewTab
        server={p.server}
        state={p.state}
        health={p.health}
        stats={p.stats}
        isSwarm={p.isSwarm}
        orgSlug={p.orgSlug}
      />
    </div>
  );
}
