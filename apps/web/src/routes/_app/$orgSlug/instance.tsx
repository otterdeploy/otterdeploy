/**
 * Instance settings — install-wide configuration, one level above any
 * workspace (the Coolify "instance settings" analog). Everything here edits
 * the platform_settings singleton: the control-plane domain (the dashboard's
 * own address), the public IP behind sslip.io fallbacks, edge-proxy defaults,
 * and the transactional-email transport. Workspace-scoped settings (base
 * domain, Cloudflare, team) stay on the Settings page.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { ControlPlaneCard } from "./-components/settings-control-plane";
import { ServerHealthCard } from "./-components/instance-health";
import { ServerIpCard } from "./-components/instance-server-ip";
import { EdgeDefaultsCard } from "./-components/instance-edge";
import { EmailCard } from "./-components/settings-email";
import { UpdatesCard } from "./-components/instance-updates";

export const Route = createFileRoute("/_app/$orgSlug/instance")({
  staticData: { crumb: "Instance" },
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

      <ServerHealthCard />
      <UpdatesCard />
      <ControlPlaneCard organizationId={organization.id as never} />
      <ServerIpCard organizationId={organization.id as never} />
      <EdgeDefaultsCard organizationId={organization.id as never} />
      <EmailCard organizationId={organization.id as never} />
    </Page>
  );
}
