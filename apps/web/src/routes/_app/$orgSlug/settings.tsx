/**
 * Organization settings — the workspace-scoped configuration: base domain +
 * Cloudflare hookup. Install-wide settings (control-plane domain, public IP,
 * edge defaults, email transport) live on the Instance page.
 *
 * Each card is a self-contained component under `-components/`.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { DomainCard } from "./-components/settings-domain";
import { CloudflareCard } from "./-components/settings-cloudflare";

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
      <CloudflareCard organizationId={organization.id as never} />
    </Page>
  );
}
