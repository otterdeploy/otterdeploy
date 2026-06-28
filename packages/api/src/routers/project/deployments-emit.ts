/**
 * Notification emitters for the deployment lifecycle. Each fans a `deploy.*`
 * event out to subscribed notification channels and is best-effort — never
 * throws into the deploy path (emitPlatformEvent swallows its own errors).
 */
import type { DeploymentId, OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";

import { emitPlatformEvent } from "../../notifications/emit";

/** Resolve org + project/resource display names from a resource id, for the
 *  deploy.* notification emitters. Returns null if the resource is gone. */
export async function resolveDeployContext(resourceId: ResourceId): Promise<{
  organizationId: OrganizationId;
  resourceName: string;
  projectName: string;
} | null> {
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(resource.id, resourceId));
  return info ? { ...info, organizationId: info.organizationId as OrganizationId } : null;
}

/**
 * Fan a `deploy.started` event out to subscribed notification channels.
 * Best-effort — never throws into the deploy path. Call this right after a
 * deployment row is created, from EVERY path that inserts one: insertDeployment
 * (databases), manifest-apply (service create/deploy), and handle-push (git
 * push).
 */
export async function emitDeployStarted(input: {
  deploymentId: DeploymentId;
  resourceId: ResourceId;
  reason: string;
}): Promise<void> {
  const info = await resolveDeployContext(input.resourceId);
  if (!info) return;
  await emitPlatformEvent({
    organizationId: info.organizationId,
    eventId: "deploy.started",
    title: "Deploy started",
    message: `${info.resourceName} — ${input.reason}`,
    data: {
      deploymentId: input.deploymentId,
      resource: info.resourceName,
      project: info.projectName,
    },
  });
}

export async function emitDeploySucceeded(input: {
  deploymentId: DeploymentId;
  resourceId: ResourceId;
}): Promise<void> {
  const info = await resolveDeployContext(input.resourceId);
  if (!info) return;
  await emitPlatformEvent({
    organizationId: info.organizationId,
    eventId: "deploy.succeeded",
    title: "Deploy succeeded",
    message: `${info.resourceName} is now running`,
    data: {
      deploymentId: input.deploymentId,
      resource: info.resourceName,
      project: info.projectName,
    },
  });
}
