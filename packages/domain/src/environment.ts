import { Result } from "better-result";
import { db, eq, and } from "@otterstack/db";
import { project, projectEnvironment } from "@otterstack/db/schema/architecture";

import { NotFoundError } from "./errors";

function formatEnvironment(row: typeof projectEnvironment.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createEnvironment(params: {
  projectId: string;
  organizationId: string;
  name: string;
}): Promise<Result<ReturnType<typeof formatEnvironment>, NotFoundError>> {
  const proj = await db.query.project.findFirst({
    where: and(eq(project.id, params.projectId), eq(project.organizationId, params.organizationId)),
  });
  if (!proj) return Result.err(new NotFoundError({ resource: "project", id: params.projectId }));

  const now = new Date();
  const env = {
    id: crypto.randomUUID(),
    projectId: params.projectId,
    name: params.name,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(projectEnvironment).values(env);
  return Result.ok(formatEnvironment(env));
}

export async function getEnvironmentById(
  environmentId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatEnvironment>, NotFoundError>> {
  const row = await db.query.projectEnvironment.findFirst({
    where: eq(projectEnvironment.id, environmentId),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "environment", id: environmentId }));
  }
  return Result.ok(formatEnvironment(row));
}

export async function listEnvironments(
  projectId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatEnvironment>[], NotFoundError>> {
  const proj = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!proj) return Result.err(new NotFoundError({ resource: "project", id: projectId }));

  const rows = await db.query.projectEnvironment.findMany({
    where: eq(projectEnvironment.projectId, projectId),
  });

  return Result.ok(rows.map(formatEnvironment));
}

export async function deleteEnvironment(
  environmentId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const row = await db.query.projectEnvironment.findFirst({
    where: eq(projectEnvironment.id, environmentId),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "environment", id: environmentId }));
  }

  await db.delete(projectEnvironment).where(eq(projectEnvironment.id, environmentId));
  return Result.ok({ success: true as const });
}
