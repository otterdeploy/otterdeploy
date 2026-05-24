import { z } from "zod";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { NewResourceWizard } from "@/features/projects/components/new-resource/new-resource-wizard";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

const zNewResourceSearch = z.object({ kind: z.string().optional() });

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  staticData: { crumb: "New resource" },
  validateSearch: zNewResourceSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const { kind } = Route.useSearch();

  return (
    <NewResourceWizard
      layout="page"
      orgSlug={organization.slug}
      projectSlug={project.slug as Slug<typeof ID_PREFIX.project>}
      projectName={project.name}
      initialKind={kind ?? null}
      initialStep={kind ? "version" : "kind"}
    />
  );
}
