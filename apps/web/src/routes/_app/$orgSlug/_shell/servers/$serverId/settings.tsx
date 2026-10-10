// Server › Settings: firewall, machine facts, removal; swarm controls on Swarm only.
import { createFileRoute } from "@tanstack/react-router";

import { ServerSettingsTab } from "./-components/server-detail-settings";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/settings")({
  staticData: { view: ["settings"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  const navigate = Route.useNavigate();
  if (!p.server) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <ServerSettingsTab
        server={p.server}
        node={p.node}
        swarmView={p.swarmView}
        onRemoved={() => void navigate({ to: "/$orgSlug/servers", params: { orgSlug: p.orgSlug } })}
      />
    </div>
  );
}
