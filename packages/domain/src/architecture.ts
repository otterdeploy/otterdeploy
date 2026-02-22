import { Result } from "better-result";
import { db, eq, and } from "@otterdeploy/db";
import {
  project,
  projectEnvironment,
  projectResource,
  projectResourceLink,
  projectViewport,
} from "@otterdeploy/db/schema/architecture";

import { NotFoundError } from "./errors";

async function getOrCreateEnvironment(
  projectId: string,
  environmentId?: string,
): Promise<Result<typeof projectEnvironment.$inferSelect, NotFoundError>> {
  const existing = await db.query.projectEnvironment.findFirst({
    where: environmentId
      ? eq(projectEnvironment.id, environmentId)
      : eq(projectEnvironment.projectId, projectId),
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
    id: crypto.randomUUID(),
    projectId,
    name: "production",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(projectEnvironment).values(created);
  await db.insert(projectViewport).values({
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

function formatEnvironmentForGraph(row: typeof projectEnvironment.$inferSelect) {
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
  const environment = envResult.value;

  const [resources, links, viewport] = await Promise.all([
    db.query.projectResource.findMany({
      where: eq(projectResource.environmentId, environment.id),
    }),
    db.query.projectResourceLink.findMany({
      where: eq(projectResourceLink.environmentId, environment.id),
    }),
    db.query.projectViewport.findFirst({
      where: eq(projectViewport.environmentId, environment.id),
    }),
  ]);

  const ensuredViewport =
    viewport ??
    (await (async () => {
      const newViewport = {
        environmentId: environment.id,
        x: 0,
        y: 0,
        zoom: 1,
        updatedAt: new Date(),
      };
      await db.insert(projectViewport).values(newViewport).onConflictDoNothing();
      return newViewport;
    })());

  return Result.ok({
    project: formatProjectForGraph(projectRow),
    environment: formatEnvironmentForGraph(environment),
    viewport: {
      x: ensuredViewport.x,
      y: ensuredViewport.y,
      zoom: ensuredViewport.zoom,
    },
    nodes: resources.map((resource) => ({
      id: resource.id,
      type: "resource" as const,
      position: {
        x: resource.posX,
        y: resource.posY,
      },
      data: {
        name: resource.name,
        kind: resource.kind,
        status: resource.status,
        metadata: resource.metadata,
      },
    })),
    edges: links.map((link) => ({
      id: link.id,
      source: link.sourceResourceId,
      target: link.targetResourceId,
      data: {
        linkType: link.linkType,
      },
      type: "smoothstep" as const,
    })),
  });
}

export async function replaceProjectGraph(params: {
  projectId: string;
  organizationId: string;
  environmentId?: string;
  resources: Array<{
    id: string;
    name: string;
    kind: "web" | "api" | "worker" | "database" | "cache" | "volume";
    status: "online" | "degraded" | "crashed" | "unknown" | "deploying" | "stopped";
    metadata: Record<string, unknown>;
    posX: number;
    posY: number;
  }>;
  links: Array<{
    id: string;
    sourceResourceId: string;
    targetResourceId: string;
    linkType: "depends_on" | "network" | "mounts";
  }>;
  viewport: { x: number; y: number; zoom: number };
}) {
  const projectRow = await db.query.project.findFirst({
    where: and(eq(project.id, params.projectId), eq(project.organizationId, params.organizationId)),
  });
  if (!projectRow) return Result.err(new NotFoundError({ resource: "project", id: params.projectId }));

  const envResult = await getOrCreateEnvironment(params.projectId, params.environmentId);
  if (envResult.isErr()) return envResult;
  const environment = envResult.value;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .delete(projectResourceLink)
      .where(eq(projectResourceLink.environmentId, environment.id));
    await tx
      .delete(projectResource)
      .where(eq(projectResource.environmentId, environment.id));

    if (params.resources.length > 0) {
      await tx.insert(projectResource).values(
        params.resources.map((resource) => ({
          id: resource.id,
          environmentId: environment.id,
          kind: resource.kind,
          name: resource.name,
          status: resource.status,
          metadata: resource.metadata,
          posX: resource.posX,
          posY: resource.posY,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const validNodeIds = new Set(params.resources.map((r) => r.id));
    const linksToInsert = params.links
      .filter(
        (link) =>
          validNodeIds.has(link.sourceResourceId) && validNodeIds.has(link.targetResourceId),
      )
      .map((link) => ({
        id: link.id,
        environmentId: environment.id,
        sourceResourceId: link.sourceResourceId,
        targetResourceId: link.targetResourceId,
        linkType: link.linkType,
        createdAt: now,
        updatedAt: now,
      }));

    if (linksToInsert.length > 0) {
      await tx.insert(projectResourceLink).values(linksToInsert);
    }

    await tx
      .insert(projectViewport)
      .values({
        environmentId: environment.id,
        x: params.viewport.x,
        y: params.viewport.y,
        zoom: params.viewport.zoom,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectViewport.environmentId,
        set: {
          x: params.viewport.x,
          y: params.viewport.y,
          zoom: params.viewport.zoom,
          updatedAt: now,
        },
      });
  });

  return getProjectGraph(params.projectId, params.organizationId, environment.id);
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
  const environment = envResult.value;

  await db
    .insert(projectViewport)
    .values({
      environmentId: environment.id,
      x: params.viewport.x,
      y: params.viewport.y,
      zoom: params.viewport.zoom,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: projectViewport.environmentId,
      set: {
        x: params.viewport.x,
        y: params.viewport.y,
        zoom: params.viewport.zoom,
        updatedAt: new Date(),
      },
    });

  return Result.ok({
    environmentId: environment.id,
    viewport: {
      x: params.viewport.x,
      y: params.viewport.y,
      zoom: params.viewport.zoom,
    },
  });
}
