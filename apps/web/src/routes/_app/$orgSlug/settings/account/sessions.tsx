/**
 * Account → Sessions — everywhere this account is signed in: device sessions,
 * CLI access, and the sign-out-everywhere escape hatch. Self-scoped
 * (better-auth client APIs), no RBAC gating.
 */

import { createFileRoute } from "@tanstack/react-router";

import { CliCard } from "@/features/account/cli-card";
import { DangerCard } from "@/features/account/danger-card";
import { SessionsCard } from "@/features/account/sessions-card";
import { Page, PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_app/$orgSlug/settings/account/sessions")({
  staticData: { crumb: "Sessions" },
  component: SessionsRoute,
});

function SessionsRoute() {
  const { orgSlug } = Route.useParams();

  return (
    <Page width="narrow">
      <PageHeader
        title="Sessions"
        description="Devices and machines signed in as you — browsers, the CLI, and the kill switch."
      />

      <SessionsCard />
      <CliCard orgSlug={orgSlug} />
      <DangerCard />
    </Page>
  );
}
