/**
 * Import from Coolify. Split out of the single Instance page (./index.tsx):
 * a one-time job, not something you configure.
 */

import { createFileRoute } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { MigrationCard } from "./-components/instance-migration";

export const Route = createFileRoute("/_app/$orgSlug/_settings/instance/migration")({
  staticData: { crumb: "Migration" },
  component: MigrationRoute,
});

function MigrationRoute() {
  return (
    <Page width="narrow">
      <PageHeader title="Migration" description="Bring projects over from another platform." />

      <MigrationCard />
    </Page>
  );
}
