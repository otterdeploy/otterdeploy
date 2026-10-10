// Server › Terminal: a host shell on the control plane; Coming soon elsewhere.
import { createFileRoute } from "@tanstack/react-router";

import { ServerTerminalTab } from "./-components/server-detail-shell";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/terminal")({
  staticData: { view: ["terminal"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  if (!p.server) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6 min-h-0">
      <ServerTerminalTab server={p.server} orgSlug={p.orgSlug} />
    </div>
  );
}
