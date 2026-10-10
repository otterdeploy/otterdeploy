import { createFileRoute } from "@tanstack/react-router";

import { BackupsPage, preloadBackups } from "./-components/backups-page";

// The Data section's index: every database and whether a schedule protects it.
export const Route = createFileRoute("/_app/$orgSlug/_shell/data/")({
  staticData: { crumb: "Data" },
  component: RouteComponent,
  loader: preloadBackups,
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  return <BackupsPage orgSlug={orgSlug} view="coverage" />;
}
