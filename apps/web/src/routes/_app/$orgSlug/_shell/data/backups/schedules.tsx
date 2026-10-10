import { createFileRoute } from "@tanstack/react-router";

import { BackupsPage, preloadBackups } from "../-components/backups-page";

// The recurring backup pipelines.
export const Route = createFileRoute("/_app/$orgSlug/_shell/data/backups/schedules")({
  staticData: { crumb: "Backups" },
  component: RouteComponent,
  loader: preloadBackups,
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  return <BackupsPage orgSlug={orgSlug} view="schedules" />;
}
