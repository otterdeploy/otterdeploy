/**
 * Instance settings: install-wide configuration, one level above any
 * workspace. Everything here edits the platform_settings singleton.
 *
 * The page used to hold ten cards across four subjects. It is split by
 * subject now: this page keeps the install itself (updates, the control-plane
 * domain, the public IP, and the Runtime card's install-wide knobs); who can
 * sign in is ./access; the Coolify import is ./migration. The edge defaults
 * and CrowdSec settings moved to Edge, beside the config and the firewall
 * they shape. Workspace-scoped
 * settings (base domain, Cloudflare, team) live under Workspace.
 *
 * Pages are visible to install admins only (./layout.tsx); mutations are
 * RBAC-gated inside each card.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { RuntimeSettingsCard } from "./-components/instance-runtime";
import { ServerIpCard } from "./-components/instance-server-ip";
import { UpdatesCard } from "./-components/instance-updates";
import { ControlPlaneCard } from "./-components/settings-control-plane";

export const Route = createFileRoute("/_app/$orgSlug/_settings/instance/")({
  staticData: { crumb: "Instance" },
  component: InstanceRoute,
});

function InstanceRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  return (
    <Page width="narrow">
      <PageHeader
        title="Instance"
        description="Install-wide configuration for this server. Applies to every workspace."
      />

      <UpdatesCard />
      <ControlPlaneCard organizationId={organization.id} />
      <ServerIpCard organizationId={organization.id} />
      <RuntimeSettingsCard organizationId={organization.id} />
    </Page>
  );
}
