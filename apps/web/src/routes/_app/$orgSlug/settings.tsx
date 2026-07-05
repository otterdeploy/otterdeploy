/**
 * Organization settings — domain section + control-plane domain + Cloudflare
 * hookup + email transport.
 *
 * Each card is a self-contained component under `-components/`: the domain card
 * (base domain + TXT verification), the control-plane card (the dashboard's own
 * domain, platform-wide), the Cloudflare connect card (DNS auto-configure), and
 * the email transport card.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { DomainCard } from "./-components/settings-domain";
import { ControlPlaneCard } from "./-components/settings-control-plane";
import { CloudflareCard } from "./-components/settings-cloudflare";
import { EmailCard } from "./-components/settings-email";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
  staticData: { crumb: "Settings" },
  component: SettingsRoute,
});

function SettingsRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  return (
    <Page width="narrow">
      <PageHeader
        title="Settings"
        description={
          <>
            Workspace-wide configuration for{" "}
            <span className="font-medium text-foreground">
              {organization.name}
            </span>
            .
          </>
        }
      />

      <DomainCard organizationId={organization.id as never} />
      <ControlPlaneCard organizationId={organization.id as never} />
      <CloudflareCard organizationId={organization.id as never} />
      <EmailCard organizationId={organization.id as never} />
    </Page>
  );
}
