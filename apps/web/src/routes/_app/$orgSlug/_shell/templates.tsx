/**
 * Templates — org-level gallery of curated, deployable compose stacks.
 * Composition lives in features/templates/. `?project=<slug>` preselects the
 * deploy target in the detail modal (set when the kind picker's "From
 * template" card sends the operator here from inside a project).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { TemplatesGallery } from "@/features/templates/components/templates-gallery";

// Zod so the field infers as optional — `navigate({ to: this route })` then
// works without a `search` object at call sites that have no project context.
const searchSchema = z.object({
  project: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/templates")({
  staticData: { crumb: "Templates" },
  validateSearch: searchSchema,
  component: TemplatesRoute,
});

function TemplatesRoute() {
  const { orgSlug } = Route.useParams();
  const { project } = Route.useSearch();
  return <TemplatesGallery orgSlug={orgSlug} initialProjectSlug={project} />;
}
