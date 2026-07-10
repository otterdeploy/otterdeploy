/**
 * Databases — org-wide catalog of every database resource across the org's
 * projects. Composition lives in features/databases/.
 */
import { createFileRoute } from "@tanstack/react-router";

import { DatabasesPage } from "@/features/databases/databases-page";

export const Route = createFileRoute("/_app/$orgSlug/databases")({
  staticData: { crumb: "Databases" },
  component: DatabasesRoute,
});

function DatabasesRoute() {
  const { orgSlug } = Route.useParams();
  return <DatabasesPage orgSlug={orgSlug} />;
}
