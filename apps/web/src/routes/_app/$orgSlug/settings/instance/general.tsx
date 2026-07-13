/**
 * Instance settings — install-wide configuration, one level above any
 * workspace (the Coolify "instance settings" analog). Everything here edits
 * the platform_settings singleton: the control-plane domain (the dashboard's
 * own address), the public IP behind sslip.io fallbacks, edge-proxy defaults,
 * and the transactional-email transport. Workspace-scoped settings (base
 * domain, Cloudflare, team) live under Workspace → General. Pages are
 * visible to every member; mutations are RBAC-gated inside each card.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { ControlPlaneCard } from "../../-components/settings-control-plane";
import { ServerIpCard } from "../../-components/instance-server-ip";
import { EdgeDefaultsCard } from "../../-components/instance-edge";
import { EmailCard } from "../../-components/settings-email";
import { UpdatesCard } from "../../-components/instance-updates";

export const Route = createFileRoute("/_app/$orgSlug/settings/instance/general")({
  staticData: { crumb: "General" },
  component: InstanceRoute,
});

function InstanceRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  return (
    <Page width="narrow">
      <PageHeader
        title="Instance"
        description="Install-wide configuration for this server — applies to every workspace."
      />

      <UpdatesCard />
      <ControlPlaneCard organizationId={organization.id} />
      <ServerIpCard organizationId={organization.id} />
      <EdgeDefaultsCard organizationId={organization.id} />
      <EmailCard organizationId={organization.id} />
    </Page>
  );
}
