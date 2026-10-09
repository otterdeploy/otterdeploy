/**
 * The one host dir a git compose stack's build writes for the stack to use
 * after the build: its copy of the repo's bind-mount sources.
 *
 * The build helper container does not mount the data folder, so a file the
 * pipeline writes there lands in the helper's own filesystem and is gone when
 * it exits. That is right for the build scratch, and wrong for a bind source
 * a running service mounts from the host: n8n's Postgres was created with a
 * mount whose source did not exist ("bind source path does not exist"). The
 * handler mounts exactly this dir, same-path, into the
 * helper of a git stack's build. Nothing wider: the helper still sees no other
 * resource's files.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { composeResource, deployment, project, resource } from "@otterdeploy/db/schema";
import { idSchema } from "@otterdeploy/shared/id";
import { composeRepoBindDir } from "@otterdeploy/shared/paths";
import { eq } from "drizzle-orm";

/** The bind-source dir of the git stack this deployment builds, or null when
 *  it builds anything else. */
export async function resolveComposeBindDir(deploymentId: DeploymentId): Promise<string | null> {
  const [row] = await db
    .select({
      organizationId: project.organizationId,
      projectId: resource.projectId,
      environmentId: resource.environmentId,
      resourceId: resource.id,
      source: composeResource.source,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  if (!row || row.source !== "git") return null;
  return composeRepoBindDir({
    organizationId: idSchema.organization.parse(row.organizationId),
    projectId: row.projectId,
    environmentId: row.environmentId ?? null,
    resourceId: row.resourceId,
  });
}
