/**
 * Instance settings (od-u63.7 label-only rename; path unchanged: this file
 * still lives at `/settings/instance/general`): install-wide configuration,
 * one level above any workspace.
 * Everything here edits the platform_settings singleton: the control-plane
 * domain (the dashboard's own address), the public IP behind sslip.io
 * fallbacks, edge-proxy defaults, who can sign in, and runtime knobs.
 * Workspace-scoped settings (base domain, Cloudflare, team) live under
 * Workspace → Domains. Pages are visible to every member; mutations are
 * RBAC-gated inside each card.
 *
 * Delivery credentials are deliberately NOT here: the email transport and the
 * Twilio/FCM keys are configured on Workspace → Notifications, beside the
 * channels that consume them. They still write the same platform_settings
 * singleton: only the surface moved.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { ControlPlaneCard } from "../../-components/settings-control-plane";
import { AccessCard } from "../../-components/instance-access";
import { CrowdsecCard } from "../../-components/instance-crowdsec";
import { RuntimeSettingsCard } from "../../-components/instance-runtime";
import { ServerIpCard } from "../../-components/instance-server-ip";
import { SocialSignInCard } from "../../-components/instance-social-sign-in";
import { EdgeDefaultsCard } from "../../-components/instance-edge";
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
        description="Install-wide configuration for this server. Applies to every workspace."
      />

      <UpdatesCard />
      <ControlPlaneCard organizationId={organization.id} />
      <ServerIpCard organizationId={organization.id} />
      <EdgeDefaultsCard organizationId={organization.id} />
      {/* Identity before enforcement before knobs: who gets in is the setting
          an operator comes here for most often. */}
      <AccessCard organizationId={organization.id} />
      <SocialSignInCard organizationId={organization.id} />
      <CrowdsecCard organizationId={organization.id} />
      <RuntimeSettingsCard organizationId={organization.id} />
    </Page>
  );
}
