/**
 * Instance settings (od-u63.7 label-only rename; path unchanged — this file
 * still lives at `/settings/instance/general`) — install-wide configuration,
 * one level above any workspace (the Coolify "instance settings" analog).
 * Everything here edits the platform_settings singleton: the control-plane
 * domain (the dashboard's own address), the public IP behind sslip.io
 * fallbacks, edge-proxy defaults, and the transactional-email transport.
 * Workspace-scoped settings (base domain, Cloudflare, team) live under
 * Workspace → Domains. Pages are visible to every member; mutations are
 * RBAC-gated inside each card.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { ControlPlaneCard } from "../../-components/settings-control-plane";
import { AccessCard } from "../../-components/instance-access";
import { CrowdsecCard } from "../../-components/instance-crowdsec";
import { MessagingCard } from "../../-components/instance-messaging";
import { RuntimeSettingsCard } from "../../-components/instance-runtime";
import { ServerIpCard } from "../../-components/instance-server-ip";
import { SocialSignInCard } from "../../-components/instance-social-sign-in";
import { EdgeDefaultsCard } from "../../-components/instance-edge";
import { EmailCard } from "../../-components/settings-email";
import { UpdatesCard } from "../../-components/instance-updates";

export const Route = createFileRoute("/_app/$orgSlug/settings/instance/general")({
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

      <UpdatesCard />
      <ControlPlaneCard organizationId={organization.id} />
      <ServerIpCard organizationId={organization.id} />
      <EdgeDefaultsCard organizationId={organization.id} />
      {/* Identity before delivery before enforcement before knobs — who gets in
          is the setting an operator comes here for most often. */}
      <AccessCard organizationId={organization.id} />
      <SocialSignInCard organizationId={organization.id} />
      <EmailCard organizationId={organization.id} />
      <MessagingCard organizationId={organization.id} />
      <CrowdsecCard organizationId={organization.id} />
      <RuntimeSettingsCard organizationId={organization.id} />
    </Page>
  );
}
