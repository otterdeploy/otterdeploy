import { db, eq, and } from "@otterstack/db";
import {
  project,
  projectEnvironment,
} from "@otterstack/db/schema/architecture";

import { DomainError } from "./errors";

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
}) {
  const proj = await db.query.project.findFirst({
    where: and(eq(project.id, params.projectId), eq(project.organizationId, params.organizationId)),
  });
  if (!proj) throw new DomainError("NOT_FOUND", "Project not found");

  const now = new Date();
  const env = {
    id: crypto.randomUUID(),
    projectId: params.projectId,
    name: params.name,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(projectEnvironment).values(env);
  return formatEnvironment(env);
}

export async function getEnvironmentById(environmentId: string, organizationId: string) {
  const row = await db.query.projectEnvironment.findFirst({
    where: eq(projectEnvironment.id, environmentId),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    throw new DomainError("NOT_FOUND", "Environment not found");
  }
  return formatEnvironment(row);
}

export async function listEnvironments(projectId: string, organizationId: string) {
  const proj = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!proj) throw new DomainError("NOT_FOUND", "Project not found");

  const rows = await db.query.projectEnvironment.findMany({
    where: eq(projectEnvironment.projectId, projectId),
  });

  return rows.map(formatEnvironment);
}

export async function deleteEnvironment(environmentId: string, organizationId: string) {
  const row = await db.query.projectEnvironment.findFirst({
    where: eq(projectEnvironment.id, environmentId),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    throw new DomainError("NOT_FOUND", "Environment not found");
  }

  await db.delete(projectEnvironment).where(eq(projectEnvironment.id, environmentId));
  return { success: true as const };
}
