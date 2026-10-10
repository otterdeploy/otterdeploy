/**
 * Server › Storage: disks, Docker's own usage and reclaim, and on the control
 * plane the volumes on its daemon (moved here from the fleet's Docker tab:
 * same subject as disk usage and reclaim).
 */
import { createFileRoute } from "@tanstack/react-router";

import { VolumesSection } from "@/features/volumes/volumes-section";

import { ServerStorageTab } from "./-components/server-detail-storage";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/storage")({
  staticData: { view: ["storage"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  if (!p.server || !p.state) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <ServerStorageTab
        server={p.server}
        health={p.health}
        state={p.state}
        isInstallAdmin={p.isInstallAdmin}
      />
      {/* The volume inventory reads the control plane's daemon and is
          install-admin, like the rest of the raw daemon view. */}
      {p.isControlPlane && p.isInstallAdmin ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-medium">Volumes</h2>
            <span className="text-[12px] text-muted-foreground">
              on this daemon, with the resource that owns each
            </span>
          </div>
          <VolumesSection orgSlug={p.orgSlug} />
        </section>
      ) : null}
    </div>
  );
}
