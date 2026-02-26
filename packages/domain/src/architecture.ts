import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import {
  project,
  environment,
  resource,
  resourcePosition,
  viewport,
} from "@otterdeploy/db/schema/project";

import { createId } from "@otterdeploy/utils";

import { NotFoundError } from "./errors";

async function getOrCreateEnvironment(
  projectId: string,
  environmentId?: string,
): Promise<Result<typeof environment.$inferSelect, NotFoundError>> {
  const existing = await db.query.environment.findFirst({
    where: environmentId
      ? eq(environment.id, environmentId)
      : eq(environment.projectId, projectId),
    ...(environmentId ? {} : { orderBy: (pe: any, { asc }: any) => [asc(pe.createdAt)] }),
  });

  if (existing) {
    if (environmentId && existing.projectId !== projectId) {
      return Result.err(new NotFoundError({ resource: "environment", id: environmentId }));
    }
    return Result.ok(existing);
  }

  if (environmentId) {
    return Result.err(new NotFoundError({ resource: "environment", id: environmentId }));
  }

  const now = new Date();
  const created = {
    id: createId(),
    projectId,
    name: "production",
    slug: "production",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(environment).values(created);
  await db.insert(viewport).values({
    environmentId: created.id,
    x: 0,
    y: 0,
    zoom: 1,
    updatedAt: now,
  });

  return Result.ok(created);
}

function formatProjectForGraph(row: typeof project.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId!,
    ownerId: row.ownerId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatEnvironmentForGraph(row: typeof environment.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getProjectGraph(
  projectId: string,
  organizationId: string,
  environmentId?: string,
) {
  const projectRow = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!projectRow) return Result.err(new NotFoundError({ resource: "project", id: projectId }));

  const envResult = await getOrCreateEnvironment(projectId, environmentId);
  if (envResult.isErr()) return envResult;
  const env = envResult.value;

  const [resources, viewportRow] = await Promise.all([
    db.query.resource.findMany({
      where: eq(resource.environmentId, env.id),
      with: { position: true },
    }),
    db.query.viewport.findFirst({
      where: eq(viewport.environmentId, env.id),
    }),
  ]);

  const ensuredViewport =
    viewportRow ??
    (await (async () => {
      const newViewport = {
        environmentId: env.id,
        x: 0,
        y: 0,
        zoom: 1,
        updatedAt: new Date(),
      };
      await db.insert(viewport).values(newViewport).onConflictDoNothing();
      return newViewport;
    })());

  return Result.ok({
    project: formatProjectForGraph(projectRow),
    environment: formatEnvironmentForGraph(env),
    viewport: {
      x: ensuredViewport.x,
      y: ensuredViewport.y,
      zoom: ensuredViewport.zoom,
    },
    nodes: resources.map((r) => ({
      id: r.id,
      type: "resource" as const,
      position: {
        x: r.position?.posX ?? 0,
        y: r.position?.posY ?? 0,
      },
      data: {
        name: r.name,
        kind: r.kind,
        status: r.status,
      },
    })),
    edges: [],
  });
}

export async function replaceProjectGraph(params: {
  projectId: string;
  organizationId: string;
  environmentId?: string;
  resources: Array<{
    id: string;
    name: string;
    kind: "web" | "api" | "worker" | "database" | "compose";
    status: "online" | "degraded" | "crashed" | "unknown" | "deploying" | "stopped";
    posX: number;
    posY: number;
  }>;
  viewport: { x: number; y: number; zoom: number };
}) {
  const projectRow = await db.query.project.findFirst({
    where: and(eq(project.id, params.projectId), eq(project.organizationId, params.organizationId)),
  });
  if (!projectRow) return Result.err(new NotFoundError({ resource: "project", id: params.projectId }));

  const envResult = await getOrCreateEnvironment(params.projectId, params.environmentId);
  if (envResult.isErr()) return envResult;
  const env = envResult.value;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .delete(resource)
      .where(eq(resource.environmentId, env.id));

    if (params.resources.length > 0) {
      await tx.insert(resource).values(
        params.resources.map((r) => ({
          id: r.id,
          organizationId: params.organizationId,
          projectId: params.projectId,
          environmentId: env.id,
          kind: r.kind,
          name: r.name,
          status: r.status,
          createdAt: now,
          updatedAt: now,
        })),
      );

      await tx.insert(resourcePosition).values(
        params.resources.map((r) => ({
          resourceId: r.id,
          posX: r.posX,
          posY: r.posY,
          updatedAt: now,
        })),
      );
    }

    await tx
      .insert(viewport)
      .values({
        environmentId: env.id,
        x: params.viewport.x,
        y: params.viewport.y,
        zoom: params.viewport.zoom,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: viewport.environmentId,
        set: {
          x: params.viewport.x,
          y: params.viewport.y,
          zoom: params.viewport.zoom,
          updatedAt: now,
        },
      });
  });

  return getProjectGraph(params.projectId, params.organizationId, env.id);
}

export async function updateViewport(params: {
  projectId: string;
  organizationId: string;
  environmentId?: string;
  viewport: { x: number; y: number; zoom: number };
}): Promise<Result<{ environmentId: string; viewport: { x: number; y: number; zoom: number } }, NotFoundError>> {
  const projectRow = await db.query.project.findFirst({
    where: and(eq(project.id, params.projectId), eq(project.organizationId, params.organizationId)),
  });
  if (!projectRow) return Result.err(new NotFoundError({ resource: "project", id: params.projectId }));

  const envResult = await getOrCreateEnvironment(params.projectId, params.environmentId);
  if (envResult.isErr()) return envResult;
  const env = envResult.value;

  await db
    .insert(viewport)
    .values({
      environmentId: env.id,
      x: params.viewport.x,
      y: params.viewport.y,
      zoom: params.viewport.zoom,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: viewport.environmentId,
      set: {
        x: params.viewport.x,
        y: params.viewport.y,
        zoom: params.viewport.zoom,
        updatedAt: new Date(),
      },
    });

  return Result.ok({
    environmentId: env.id,
    viewport: {
      x: params.viewport.x,
      y: params.viewport.y,
      zoom: params.viewport.zoom,
    },
  });
}
