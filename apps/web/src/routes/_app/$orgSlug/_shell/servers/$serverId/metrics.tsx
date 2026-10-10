// Server › Metrics: CPU, load, memory, disk I/O and network over time.
import { createFileRoute } from "@tanstack/react-router";

import { ServerMetricsTab } from "./-components/server-detail-metrics";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/metrics")({
  staticData: { view: ["metrics"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  if (!p.server) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <ServerMetricsTab server={p.server} health={p.health} />
    </div>
  );
}
