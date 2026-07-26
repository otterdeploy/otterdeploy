/**
 * Workspace → Domains (od-u63.7 label-only rename; path unchanged — this file
 * still lives at `/settings/workspace/general`) — the workspace-scoped
 * configuration: base domain + Cloudflare hookup. Install-wide settings
 * (control-plane domain, public IP, edge defaults, email transport) live
 * under Instance.
 *
 * Each card is a self-contained component under `$orgSlug/-components/`.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { DomainCard } from "../../-components/settings-domain";
import { CloudflareCard } from "../../-components/settings-cloudflare";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/general")({
  staticData: { crumb: "Domains" },
  component: SettingsRoute,
});

function SettingsRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  return (
    <Page width="narrow">
      <PageHeader
        title="Domains"
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

      <DomainCard organizationId={organization.id} />
      <CloudflareCard organizationId={organization.id} />
    </Page>
  );
}
