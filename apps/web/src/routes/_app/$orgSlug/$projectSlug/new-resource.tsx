
import type { ProjectSlug, Slug } from "@otterdeploy/shared/id";
import { z } from "zod";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { PageResourceWizard } from "@/features/projects/components/new-resource/wizard";
import { STEP_IDS, type Step } from "@/features/projects/components/new-resource/schemas";
const zNewResourceSearch = z.object({
  kind: z.string().optional(),
  step: z.enum(STEP_IDS as unknown as readonly [Step, ...Step[]]).optional(),
});

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
    <PageResourceWizard
      orgSlug={organization.slug}
      projectSlug={project.slug as ProjectSlug}
      projectId={project.id}
      projectName={project.name}
      initialKind={kind ?? null}
    />
  );
}
