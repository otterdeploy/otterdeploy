/**
 * Notification emitters for the deployment lifecycle. Each fans a `deploy.*`
 * event out to subscribed notification channels and is best-effort, never
 * throws into the deploy path (emitPlatformEvent swallows its own errors).
 */
import type { DeploymentId, OrganizationId, ResourceId } from "@otterdeploy/shared/id";
import type { InboxSubject } from "@otterdeploy/shared/inbox-subject";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";

import { emitPlatformEvent } from "../../notifications/emit";

/** Resolve org + project/resource display names from a resource id, for the
 *  deploy.* notification emitters. Returns null if the resource is gone. */
async function resolveDeployContext(resourceId: ResourceId): Promise<{
  organizationId: OrganizationId;
  resourceName: string;
  projectName: string;
  projectSlug: string;
} | null> {
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
      projectSlug: project.slug,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(resource.id, resourceId));
  if (!info) return null;
  // project.organization_id is a plain text column: brand it at this boundary.
  // An unparseable id can't be routed to an org, so treat it like a gone row.
  const orgId = idSchema.organization.safeParse(info.organizationId);
  if (!orgId.success) return null;
  return { ...info, organizationId: orgId.data };
}

/**
 * Fan a `deploy.started` event out to subscribed notification channels.
 * Best-effort, never throws into the deploy path. Call this right after a
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
    message: `${info.resourceName}: ${input.reason}`,
    subject: serviceSubject(input.resourceId, info),
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
    subject: serviceSubject(input.resourceId, info),
    data: {
      deploymentId: input.deploymentId,
      resource: info.resourceName,
      project: info.projectName,
    },
  });
}

/** The resource as an inbox subject: id for folding, slug for the route. */
export function serviceSubject(
  resourceId: ResourceId,
  info: { resourceName: string; projectSlug: string },
): InboxSubject {
  return { kind: "service", id: resourceId, label: info.resourceName, project: info.projectSlug };
}
