import { createFileRoute } from "@tanstack/react-router";

import { BackupsPage, preloadBackups } from "../-components/backups-page";

// Every backup run, manual and scheduled.
export const Route = createFileRoute("/_app/$orgSlug/_shell/data/backups/")({
  staticData: { crumb: "Backups" },
  component: RouteComponent,
  loader: preloadBackups,
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  return <BackupsPage orgSlug={orgSlug} view="activity" />;
}
