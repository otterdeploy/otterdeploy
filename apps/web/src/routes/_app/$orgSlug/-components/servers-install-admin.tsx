/**
 * Everything on the Servers page that only an installation administrator may
 * see, in one place.
 *
 * Servers is a MIXED page: the Overview plane is org-scoped (`server.list` /
 * `stats` / `health` / `swarmNodes`) and belongs to every member, while
 * "Raw Docker" (`docker.*` + `volumes.list`), "Install health"
 * (`metrics.platform`) and the local host-health card (`system.hostHealth`)
 * are install-admin in their entirety. Rendering those for everyone left each
 * one to 403 on mount, which reads as a broken page rather than a permission
 * boundary.
 *
 * These are omit-not-disable and unmount-not-hide: a disabled tab still
 * advertises something you cannot have, and a rendered-then-hidden plane
 * still fires every query it owns. Presentation only. The server re-checks
 * the same flag on each of those procedures (packages/api authz).
 */

import type { ComponentProps } from "react";

import { TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import { InstallHealthSection } from "./install-health";
import { RawDockerPanel } from "./raw-docker-panel";

export function ServersTabList({ isInstallAdmin }: { isInstallAdmin: boolean }) {
  return (
    <TabsList variant="line" className="mt-3.5 h-9 justify-start gap-1">
      <TabsTrigger value="overview">Overview</TabsTrigger>
      {isInstallAdmin ? (
        <>
          <TabsTrigger value="docker">Docker</TabsTrigger>
          <TabsTrigger value="install-health">Install health</TabsTrigger>
        </>
      ) : null}
    </TabsList>
  );
}

export function InstallAdminPlanes({
  isInstallAdmin,
  orgSlug,
  dockerTab,
}: {
  isInstallAdmin: boolean;
  orgSlug: string;
  dockerTab: ComponentProps<typeof RawDockerPanel>["initialTab"];
}) {
  if (!isInstallAdmin) return null;
  return (
    <>
      <TabsContent value="docker" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <RawDockerPanel orgSlug={orgSlug} initialTab={dockerTab} />
      </TabsContent>

      <TabsContent value="install-health" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <InstallHealthSection />
      </TabsContent>
    </>
  );
}
