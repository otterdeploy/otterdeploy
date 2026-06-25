/**
 * DB ops for `type: compose` resources. A compose resource is a `resource`
 * row (type=compose) + a `compose_resource` row holding the file and derived
 * summary. See docs/designs/compose.md.
 */
import { and, asc, eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { composeResource, resource } from "@otterdeploy/db/schema/project";
import type {
  ComposeExposed,
  ComposeServiceSummary,
} from "@otterdeploy/shared/compose";
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

export interface ComposeRecord {
  resource: typeof resource.$inferSelect;
  compose: typeof composeResource.$inferSelect;
}

export async function createComposeRecord(input: {
  projectId: ProjectId;
  name: string;
  source: "inline" | "git";
  composeContent: string | null;
  gitRepoUrl?: string | null;
  gitRef?: string | null;
  sourceSubdir?: string | null;
  composePath?: string | null;
  stackName: string;
  services: ComposeServiceSummary[];
  exposed?: ComposeExposed[];
}): Promise<ComposeRecord> {
  return db.transaction(async (tx) => {
    const [res] = await tx
      .insert(resource)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: "compose",
        status: "valid",
      })
      .returning();
    if (!res) throw new Error("Failed to create compose resource row");

    const [comp] = await tx
      .insert(composeResource)
      .values({
        resourceId: res.id,
        source: input.source,
        composeContent: input.composeContent ?? null,
        gitRepoUrl: input.gitRepoUrl ?? null,
        gitRef: input.gitRef ?? null,
        sourceSubdir: input.sourceSubdir ?? null,
        composePath: input.composePath ?? null,
        stackName: input.stackName,
        services: input.services,
        exposed: input.exposed ?? [],
      })
      .returning();
    if (!comp) throw new Error("Failed to create compose_resource row");

    return { resource: res, compose: comp };
  });
}

export async function getComposeRecord(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<ComposeRecord | null> {
  const [row] = await db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(
      and(
        eq(resource.id, resourceId),
        eq(resource.projectId, projectId),
        eq(resource.type, "compose"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listComposeRecords(
  projectId: ProjectId,
): Promise<ComposeRecord[]> {
  return db
    .select({ resource, compose: composeResource })
    .from(resource)
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.type, "compose")))
    .orderBy(asc(resource.createdAt));
}

/** Replace the stack's `exposed` (service:port→domain) list. The caller
 *  re-runs the Caddy domain reconcile afterwards from the refreshed record. */
export async function updateComposeExposed(input: {
  resourceId: ResourceId;
  exposed: ComposeExposed[];
}): Promise<void> {
  await db
    .update(composeResource)
    .set({ exposed: input.exposed })
    .where(eq(composeResource.resourceId, input.resourceId));
}

export async function deleteComposeRecord(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<boolean> {
  // compose_resource cascades from resource; deleting the resource is enough.
  const [row] = await db
    .delete(resource)
    .where(
      and(
        eq(resource.id, resourceId),
        eq(resource.projectId, projectId),
        eq(resource.type, "compose"),
      ),
    )
    .returning({ id: resource.id });
  return Boolean(row);
}
