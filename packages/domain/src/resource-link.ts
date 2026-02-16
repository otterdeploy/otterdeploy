import { db, eq, and } from "@otterstack/db";
import {
  projectEnvironment,
  projectResource,
  projectResourceLink,
} from "@otterstack/db/schema/architecture";

import { DomainError } from "./errors";

function formatLink(
  row: typeof projectResourceLink.$inferSelect,
  projectId: string,
) {
  return {
    id: row.id,
    projectId,
    environmentId: row.environmentId,
    sourceResourceId: row.sourceResourceId,
    targetResourceId: row.targetResourceId,
    linkType: row.linkType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createResourceLink(params: {
  projectId: string;
  environmentId: string;
  organizationId: string;
  sourceResourceId: string;
  targetResourceId: string;
  linkType?: "depends_on" | "network" | "mounts";
}) {
  // Validate environment belongs to project and org
  const env = await db.query.projectEnvironment.findFirst({
    where: and(
      eq(projectEnvironment.id, params.environmentId),
      eq(projectEnvironment.projectId, params.projectId),
    ),
    with: { project: true },
  });
  if (!env || env.project.organizationId !== params.organizationId) {
    throw new DomainError("NOT_FOUND", "Environment not found in project");
  }

  // Validate both resources
  const [source, target] = await Promise.all([
    db.query.projectResource.findFirst({
      where: eq(projectResource.id, params.sourceResourceId),
      with: { environment: { with: { project: true } } },
    }),
    db.query.projectResource.findFirst({
      where: eq(projectResource.id, params.targetResourceId),
      with: { environment: { with: { project: true } } },
    }),
  ]);

  if (!source || source.environment.project.organizationId !== params.organizationId) {
    throw new DomainError("NOT_FOUND", "Source resource not found");
  }
  if (!target || target.environment.project.organizationId !== params.organizationId) {
    throw new DomainError("NOT_FOUND", "Target resource not found");
  }

  if (
    source.environmentId !== params.environmentId ||
    target.environmentId !== params.environmentId
  ) {
    throw new DomainError("BAD_REQUEST", "Resources must belong to the specified environment");
  }

  const now = new Date();
  const link = {
    id: crypto.randomUUID(),
    environmentId: params.environmentId,
    sourceResourceId: params.sourceResourceId,
    targetResourceId: params.targetResourceId,
    linkType: params.linkType ?? ("network" as const),
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(projectResourceLink).values(link);
  return formatLink(link as typeof projectResourceLink.$inferSelect, params.projectId);
}

export async function deleteResourceLink(linkId: string, organizationId: string) {
  const row = await db.query.projectResourceLink.findFirst({
    where: eq(projectResourceLink.id, linkId),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    throw new DomainError("NOT_FOUND", "Resource link not found");
  }

  await db.delete(projectResourceLink).where(eq(projectResourceLink.id, linkId));
  return { success: true as const };
}
