import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import {
  projectEnvironment,
  projectResource,
  projectResourceLink,
} from "@otterdeploy/db/schema/architecture";

import { NotFoundError, BadRequestError, ConflictError } from "./errors";

function formatLink(row: typeof projectResourceLink.$inferSelect, projectId: string) {
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
}): Promise<Result<ReturnType<typeof formatLink>, NotFoundError | BadRequestError | ConflictError>> {
  const env = await db.query.projectEnvironment.findFirst({
    where: and(
      eq(projectEnvironment.id, params.environmentId),
      eq(projectEnvironment.projectId, params.projectId),
    ),
    with: { project: true },
  });
  if (!env || env.project.organizationId !== params.organizationId) {
    return Result.err(new NotFoundError({ resource: "environment", id: params.environmentId }));
  }

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
    return Result.err(new NotFoundError({ resource: "source_resource", id: params.sourceResourceId }));
  }
  if (!target || target.environment.project.organizationId !== params.organizationId) {
    return Result.err(new NotFoundError({ resource: "target_resource", id: params.targetResourceId }));
  }

  if (
    source.environmentId !== params.environmentId ||
    target.environmentId !== params.environmentId
  ) {
    return Result.err(
      new BadRequestError({
        field: "environmentId",
        message: "Resources must belong to the specified environment",
      }),
    );
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

  const [inserted] = await db.insert(projectResourceLink).values(link).returning();
  if (!inserted) {
    return Result.err(new ConflictError({ resource: "resource_link", detail: "Failed to create resource link" }));
  }
  return Result.ok(formatLink(inserted, params.projectId));
}

export async function deleteResourceLink(
  linkId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const row = await db.query.projectResourceLink.findFirst({
    where: eq(projectResourceLink.id, linkId),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "resource_link", id: linkId }));
  }

  await db.delete(projectResourceLink).where(eq(projectResourceLink.id, linkId));
  return Result.ok({ success: true as const });
}
