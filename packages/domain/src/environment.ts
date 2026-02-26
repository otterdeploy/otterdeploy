import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import { project, environment } from "@otterdeploy/db/schema/project";

import { createId } from "@otterdeploy/utils";

import { NotFoundError } from "./errors";

function formatEnvironment(row: typeof environment.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    slug: row.slug,
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
  const slug = params.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "env";
  const env = {
    id: createId(),
    projectId: params.projectId,
    name: params.name,
    slug,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(environment).values(env);
  return Result.ok(formatEnvironment(env));
}

export async function getEnvironmentById(
  environmentId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatEnvironment>, NotFoundError>> {
  const row = await db.query.environment.findFirst({
    where: eq(environment.id, environmentId),
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

  const rows = await db.query.environment.findMany({
    where: eq(environment.projectId, projectId),
  });

  return Result.ok(rows.map(formatEnvironment));
}

export async function deleteEnvironment(
  environmentId: string,
  organizationId: string,
): Promise<Result<{ success: true }, NotFoundError>> {
  const row = await db.query.environment.findFirst({
    where: eq(environment.id, environmentId),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "environment", id: environmentId }));
  }

  await db.delete(environment).where(eq(environment.id, environmentId));
  return Result.ok({ success: true as const });
}
