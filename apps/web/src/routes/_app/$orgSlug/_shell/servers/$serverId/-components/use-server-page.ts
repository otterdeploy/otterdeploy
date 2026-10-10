/**
 * What every server tab needs: the route's params, whether the viewer is an
 * install administrator, and the live detail for the server. Each tab is its
 * own route now, so they read it here rather than through props from the
 * layout. The collections behind `useServerDetail` are shared, so this is a
 * subscription, not another fetch.
 */
import { getRouteApi } from "@tanstack/react-router";

import { isControlPlaneRow } from "@/features/servers/detail/server-state";
import { useServerDetail } from "@/features/servers/detail/use-server-detail";

const routeApi = getRouteApi("/_app/$orgSlug/_shell/servers/$serverId");

export function useServerPage() {
  const { orgSlug, serverId } = routeApi.useParams();
  const { isInstallAdmin } = routeApi.useRouteContext();
  const detail = useServerDetail(serverId);
  return {
    orgSlug,
    serverId,
    isInstallAdmin,
    ...detail,
    isControlPlane: detail.server ? isControlPlaneRow(detail.server) : false,
    isSwarm: detail.swarmView?.swarm ?? false,
  };
}
