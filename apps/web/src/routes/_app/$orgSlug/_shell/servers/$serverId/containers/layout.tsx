/**
 * Server › Containers: what runs on this host.
 *
 * On the control plane this is its Docker daemon, read through the socket:
 * containers grouped by project › service, then the install's own Platform
 * containers, then Unmanaged ones; plus images, networks, the live event feed
 * and, on the Swarm runtime only, tasks. It used to be a fleet-wide "Docker"
 * tab, which read this one daemon while looking like the whole fleet.
 *
 * A worker's containers need the node daemon on that box, which is not
 * built, so its tab says so instead of showing a list it cannot have. Members
 * who are not install administrators see what is placed here (the old
 * Services list), since the raw daemon view is install-admin.
 */
import { createFileRoute } from "@tanstack/react-router";

import { pickView, useRouteView } from "@/shared/hooks/use-route-view";

import { DOCKER_TABS } from "../../-components/docker-page-header";
import { RawDockerPanel } from "../../-components/raw-docker-panel";
import { CONTAINER_TAB_PATHS } from "../../-components/server-tab-paths";
import { ServerServicesTab } from "../-components/server-detail-services";
import { ComingSoon } from "../-components/server-detail-shell";
import { useServerPage } from "../-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/containers")({
  component: ContainersRoute,
});

function ContainersRoute() {
  const p = useServerPage();
  const sub = pickView(useRouteView(), 1, DOCKER_TABS, "containers");
  const navigate = Route.useNavigate();
  if (!p.server) return null;

  if (!p.isControlPlane) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <ComingSoon
          title="Containers: coming soon"
          description={`Listing what runs on ${p.server.name} needs the node daemon on that box. Today only the control plane's own daemon is readable from here.`}
        />
      </div>
    );
  }

  if (!p.isInstallAdmin) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <ServerServicesTab
          server={p.server}
          stats={p.stats}
          node={p.node}
          swarmView={p.swarmView}
          orgSlug={p.orgSlug}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <RawDockerPanel
        tab={sub}
        onTabChange={(next) =>
          void navigate({
            to: CONTAINER_TAB_PATHS[next],
            params: { orgSlug: p.orgSlug, serverId: p.serverId },
            replace: true,
          })
        }
      />
    </div>
  );
}
