/**
 * The one host dir a compose stack's build writes for the stack to use after
 * the build: a git stack's copy of the repo's bind-mount sources, or a
 * multi-file inline stack's file tree.
 *
 * The build helper container does not mount the data folder, so a file the
 * pipeline writes there lands in the helper's own filesystem and is gone when
 * it exits. That is right for the build scratch, and wrong for a bind source
 * a running service mounts from the host: n8n's Postgres was created with a
 * mount whose source did not exist ("bind source path does not exist"). The
 * handler mounts exactly this dir, same-path, into the
 * helper of the stack's build. Nothing wider: the helper still sees no other
 * resource's files.
 *
 * An inline stack with a `build:` service deploys from the helper too (the
 * build worker runs deployCompose once its images exist), and deploy writes
 * the stack's files (a bind-mounted config, an env_file) to the stack's own
 * resource dir. Unmounted, that tree was written into the helper and lost, so
 * every bind pointed at a host path that did not exist. A single-file inline
 * stack writes nothing, and gets nothing.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { composeResource, deployment, project, resource } from "@otterdeploy/db/schema";
import { idSchema } from "@otterdeploy/shared/id";
import { composeRepoBindDir, type ResourceRef, resourceDir } from "@otterdeploy/shared/paths";
import { eq, sql } from "drizzle-orm";

/** Which dir a stack of this shape needs on the host, if any. */
export function composeBindDirFor(
  stack: { source: "inline" | "git"; hasFiles: boolean },
  ref: ResourceRef,
): string | null {
  if (stack.source === "git") return composeRepoBindDir(ref);
  // deploy.ts materializeInlineTree writes the tree to the resource dir itself.
  return stack.hasFiles ? resourceDir(ref) : null;
}

/** The host dir the stack this deployment builds writes for its services, or
 *  null when it builds anything else (or a stack that writes nothing). */
export async function resolveComposeBindDir(deploymentId: DeploymentId): Promise<string | null> {
  const [row] = await db
    .select({
      organizationId: project.organizationId,
      projectId: resource.projectId,
      environmentId: resource.environmentId,
      resourceId: resource.id,
      source: composeResource.source,
      hasFiles: sql<boolean>`jsonb_array_length(${composeResource.files}) > 0`,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  if (!row) return null;
  return composeBindDirFor(row, {
    organizationId: idSchema.organization.parse(row.organizationId),
    projectId: row.projectId,
    environmentId: row.environmentId ?? null,
    resourceId: row.resourceId,
  });
}
