import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq } from "@otterstack/db";
import {
  project,
  projectEnvironment,
  projectResource,
  projectResourceLink,
  projectViewport,
} from "@otterstack/db/schema/architecture";

import { orgProcedure, orgMemberProcedure } from "../index";
import { createId } from "../utils/helpers";
import { validateProjectAccess } from "../utils/ownership";

async function getOrCreateEnvironment(projectId: string, environmentId?: string) {
  const existing = await db.query.projectEnvironment.findFirst({
    where: environmentId
      ? eq(projectEnvironment.id, environmentId)
      : eq(projectEnvironment.projectId, projectId),
    ...(environmentId ? {} : { orderBy: (pe: any, { asc }: any) => [asc(pe.createdAt)] }),
  });

  if (existing) {
    if (environmentId && existing.projectId !== projectId) {
      throw new ORPCError("NOT_FOUND", { message: "Environment not found in project" });
    }
    return existing;
  }

  if (environmentId) {
    throw new ORPCError("NOT_FOUND", { message: "Environment not found" });
  }

  const now = new Date();
  const created = {
    id: createId(),
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

  return created;
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

async function getProjectGraph(
  projectId: string,
  organizationId: string,
  environmentId?: string,
) {
  const projectRow = await validateProjectAccess(projectId, organizationId);
  const environment = await getOrCreateEnvironment(projectId, environmentId);

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

  return {
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
  };
}

export const architectureRouter = {
  getGraph: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return getProjectGraph(input.projectId, context.organizationId, input.environmentId);
    }),

  replaceGraph: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        resources: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string(),
            kind: z.enum(["web", "api", "worker", "database", "cache", "volume"]),
            status: z.enum(["online", "degraded", "crashed", "unknown", "deploying", "stopped"]),
            metadata: z.record(z.string(), z.unknown()),
            posX: z.number(),
            posY: z.number(),
          }),
        ),
        links: z.array(
          z.object({
            id: z.string().min(1),
            sourceResourceId: z.string().min(1),
            targetResourceId: z.string().min(1),
            linkType: z.enum(["depends_on", "network", "mounts"]),
          }),
        ),
        viewport: z.object({
          x: z.number(),
          y: z.number(),
          zoom: z.number(),
        }),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);
      const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .delete(projectResourceLink)
          .where(eq(projectResourceLink.environmentId, environment.id));
        await tx
          .delete(projectResource)
          .where(eq(projectResource.environmentId, environment.id));

        if (input.resources.length > 0) {
          await tx.insert(projectResource).values(
            input.resources.map((resource) => ({
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

        const validNodeIds = new Set(input.resources.map((r) => r.id));
        const linksToInsert = input.links
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
            x: input.viewport.x,
            y: input.viewport.y,
            zoom: input.viewport.zoom,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: projectViewport.environmentId,
            set: {
              x: input.viewport.x,
              y: input.viewport.y,
              zoom: input.viewport.zoom,
              updatedAt: now,
            },
          });
      });

      return getProjectGraph(input.projectId, context.organizationId, environment.id);
    }),

  updateViewport: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        viewport: z.object({
          x: z.number(),
          y: z.number(),
          zoom: z.number(),
        }),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);
      const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

      await db
        .insert(projectViewport)
        .values({
          environmentId: environment.id,
          x: input.viewport.x,
          y: input.viewport.y,
          zoom: input.viewport.zoom,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: projectViewport.environmentId,
          set: {
            x: input.viewport.x,
            y: input.viewport.y,
            zoom: input.viewport.zoom,
            updatedAt: new Date(),
          },
        });

      return {
        environmentId: environment.id,
        viewport: {
          x: input.viewport.x,
          y: input.viewport.y,
          zoom: input.viewport.zoom,
        },
      };
    }),
};
