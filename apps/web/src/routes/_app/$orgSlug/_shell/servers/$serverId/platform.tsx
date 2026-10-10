/**
 * Server › Platform (control plane only): the install's own health. Deploy
 * throughput and the job queues, formerly the fleet page's "Install health"
 * tab. They describe processes that run on the control plane, so they live on
 * its page.
 */
import { createFileRoute } from "@tanstack/react-router";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import { InstallHealthSection } from "../-components/install-health";
import { useServerPage } from "./-components/use-server-page";

export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/$serverId/platform")({
  staticData: { view: ["platform"] },
  component: RouteComponent,
});

function RouteComponent() {
  const p = useServerPage();
  if (!p.server) return null;
  if (!p.isControlPlane || !p.isInstallAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <EmptyTitle>Platform health lives on the control plane</EmptyTitle>
            <EmptyDescription>
              Deploy throughput and the job queues are the install's, and install administrators
              read them on the control-plane server.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <InstallHealthSection />
    </div>
  );
}
