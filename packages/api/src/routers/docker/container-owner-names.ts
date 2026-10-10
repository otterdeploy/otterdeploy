/**
 * Resolve the resource, project and environment behind each container's
 * owner, in three queries for the whole list, so the Containers tab can show
 * `toolbox › it-tools` (linking to that resource) rather than `res_…` ids. A
 * container whose resource row is gone keeps its id and null names.
 *
 * Install-admin only (the daemon list is), so it reads across organizations:
 * the containers on a host are whoever's they are.
 */
import { db } from "@otterdeploy/db";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import { inArray } from "drizzle-orm";

import type { ContainerOwner } from "./container-owner";
import type { ListedContainer } from "./service";

export type NamedOwner =
  | {
      kind: "resource";
      resourceId: string;
      resourceName: string | null;
      projectSlug: string | null;
      projectName: string | null;
      /** The resource's environment (the project's main one when unstamped);
       *  null when the resource row is gone. */
      environmentSlug: string | null;
    }
  | Exclude<ContainerOwner, { kind: "resource" }>;

const resourceIdSchema = zId(ID_PREFIX.resource);
const projectIdSchema = zId(ID_PREFIX.project);

export async function withOwnerNames(
  items: ListedContainer[],
): Promise<Array<Omit<ListedContainer, "owner"> & { owner: NamedOwner }>> {
  // Labels are strings off the daemon: only well-formed ids reach the query.
  const resourceIds = [
    ...new Set(items.flatMap((c) => (c.owner.kind === "resource" ? [c.owner.resourceId] : []))),
  ].flatMap((id) => {
    const parsed = resourceIdSchema.safeParse(id);
    return parsed.success ? [parsed.data] : [];
  });
  const resources =
    resourceIds.length === 0
      ? []
      : await db
          .select({
            id: resource.id,
            name: resource.name,
            projectId: resource.projectId,
            environmentId: resource.environmentId,
          })
          .from(resource)
          .where(inArray(resource.id, resourceIds));
  const projectIds = [
    ...new Set([
      ...resources.map((r) => r.projectId),
      ...items.flatMap((c) => {
        if (c.owner.kind !== "resource" || !c.owner.projectId) return [];
        const parsed = projectIdSchema.safeParse(c.owner.projectId);
        return parsed.success ? [parsed.data] : [];
      }),
    ]),
  ];
  const projects =
    projectIds.length === 0
      ? []
      : await db
          .select({
            id: project.id,
            slug: project.slug,
            name: project.name,
            mainEnvironmentId: project.environmentId,
          })
          .from(project)
          .where(inArray(project.id, projectIds));
  const environments =
    projectIds.length === 0
      ? []
      : await db
          .select({ id: environment.id, slug: environment.slug })
          .from(environment)
          .where(inArray(environment.projectId, projectIds));

  return items.map((c) => {
    if (c.owner.kind !== "resource") return { ...c, owner: c.owner };
    const { resourceId, projectSlug, projectId } = c.owner;
    const row = resources.find((r) => r.id === resourceId);
    const proj = projects.find(
      (p) =>
        p.id === (row?.projectId ?? projectId) || (projectSlug !== null && p.slug === projectSlug),
    );
    const environmentId = row ? (row.environmentId ?? proj?.mainEnvironmentId) : null;
    return {
      ...c,
      owner: {
        kind: "resource",
        resourceId,
        resourceName: row?.name ?? null,
        projectSlug: proj?.slug ?? projectSlug,
        projectName: proj?.name ?? null,
        environmentSlug: environments.find((e) => e.id === environmentId)?.slug ?? null,
      },
    };
  });
}
