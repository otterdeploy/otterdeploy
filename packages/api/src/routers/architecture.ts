import { ORPCError } from "@orpc/server";
import {
  project,
  projectEnvironment,
  projectResource,
  projectResourceLink,
  projectViewport,
} from "@otterstack/db/schema/architecture";
import { and, eq, inArray } from "@otterstack/db";
import * as z from "zod";

import { db } from "@otterstack/db";

import { protectedProcedure } from "../index";

const resourceKinds = ["web", "api", "worker", "database", "cache", "volume"] as const;
const resourceStatuses = ["online", "degraded", "crashed", "unknown"] as const;
const linkTypes = ["depends_on", "network", "mounts"] as const;

const resourceKindSchema = z.enum(resourceKinds);
const resourceStatusSchema = z.enum(resourceStatuses);
const linkTypeSchema = z.enum(linkTypes);

const nodeDataSchema = z.object({
  name: z.string().min(1),
  kind: resourceKindSchema,
  status: resourceStatusSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const graphNodeSchema = z.object({
  id: z.string().min(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: nodeDataSchema,
});

const graphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  data: z.object({
    linkType: linkTypeSchema,
  }),
});

const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

const graphStateSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  viewport: viewportSchema,
});

function requireUserId(context: { session?: { user?: { id?: string } } }) {
  const userId = context.session?.user?.id;

  if (!userId) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return userId;
}

function slugify(name: string) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return normalized || "project";
}

function createId() {
  return crypto.randomUUID();
}

async function getOwnedProject(projectId: string, ownerUserId: string) {
  const projectRow = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.ownerId, ownerUserId)),
  });

  if (!projectRow) {
    throw new ORPCError("NOT_FOUND", {
      message: "Project not found",
    });
  }

  return projectRow;
}

async function getOrCreateEnvironment(projectId: string, environmentId?: string) {
  const existingEnvironment = await db.query.projectEnvironment.findFirst({
    where: environmentId
      ? and(eq(projectEnvironment.projectId, projectId), eq(projectEnvironment.id, environmentId))
      : and(eq(projectEnvironment.projectId, projectId), eq(projectEnvironment.name, "production")),
  });

  if (existingEnvironment) {
    return existingEnvironment;
  }

  if (environmentId) {
    throw new ORPCError("NOT_FOUND", {
      message: "Environment not found",
    });
  }

  const createdEnvironment = {
    id: createId(),
    projectId,
    name: "production",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(projectEnvironment).values(createdEnvironment);

  await db.insert(projectViewport).values({
    environmentId: createdEnvironment.id,
    x: 0,
    y: 0,
    zoom: 1,
    updatedAt: new Date(),
  });

  return createdEnvironment;
}

async function getProjectGraph(projectId: string, ownerUserId: string, environmentId?: string) {
  const projectRow = await getOwnedProject(projectId, ownerUserId);
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
    project: {
      id: projectRow.id,
      name: projectRow.name,
      slug: projectRow.slug,
    },
    environment: {
      id: environment.id,
      name: environment.name,
    },
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

async function getOwnedResource(resourceId: string, ownerUserId: string) {
  const resource = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: {
        with: {
          project: true,
        },
      },
    },
  });

  if (!resource || resource.environment.project.ownerId !== ownerUserId) {
    throw new ORPCError("NOT_FOUND", {
      message: "Resource not found",
    });
  }

  return resource;
}

async function getOwnedLink(linkId: string, ownerUserId: string) {
  const link = await db.query.projectResourceLink.findFirst({
    where: eq(projectResourceLink.id, linkId),
    with: {
      environment: {
        with: {
          project: true,
        },
      },
    },
  });

  if (!link || link.environment.project.ownerId !== ownerUserId) {
    throw new ORPCError("NOT_FOUND", {
      message: "Link not found",
    });
  }

  return link;
}

export const architectureRouter = {
  project: {
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          slug: z.string().min(1).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);

        const baseSlug = slugify(input.slug ?? input.name);
        let candidateSlug = baseSlug;

        for (let attempt = 0; attempt < 10; attempt += 1) {
          const existing = await db.query.project.findFirst({
            where: eq(project.slug, candidateSlug),
          });

          if (!existing) {
            break;
          }

          candidateSlug = `${baseSlug}-${Math.floor(Math.random() * 10_000)}`;
        }

        const existing = await db.query.project.findFirst({
          where: eq(project.slug, candidateSlug),
        });

        if (existing) {
          throw new ORPCError("CONFLICT", {
            message: "Could not create a unique slug",
          });
        }

        const createdProject = {
          id: createId(),
          ownerId: userId,
          name: input.name,
          slug: candidateSlug,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await db.insert(project).values(createdProject);

        const environment = {
          id: createId(),
          projectId: createdProject.id,
          name: "production",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await db.insert(projectEnvironment).values(environment);

        await db.insert(projectViewport).values({
          environmentId: environment.id,
          x: 0,
          y: 0,
          zoom: 1,
          updatedAt: new Date(),
        });

        return {
          project: {
            id: createdProject.id,
            name: createdProject.name,
            slug: createdProject.slug,
          },
          environment: {
            id: environment.id,
            name: environment.name,
          },
        };
      }),
    getById: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        const projectRow = await getOwnedProject(input.projectId, userId);

        return {
          id: projectRow.id,
          name: projectRow.name,
          slug: projectRow.slug,
        };
      }),
  },
  architecture: {
    get: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          environmentId: z.string().min(1).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);

        return getProjectGraph(input.projectId, userId, input.environmentId);
      }),

    createResource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          environmentId: z.string().min(1).optional(),
          name: z.string().min(1),
          kind: resourceKindSchema,
          status: resourceStatusSchema.default("unknown"),
          metadata: z.record(z.string(), z.unknown()).default({}),
          position: z.object({
            x: z.number(),
            y: z.number(),
          }),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);
        const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

        const created = {
          id: createId(),
          environmentId: environment.id,
          kind: input.kind,
          name: input.name,
          status: input.status,
          metadata: input.metadata,
          posX: input.position.x,
          posY: input.position.y,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await db.insert(projectResource).values(created);

        return {
          id: created.id,
          type: "resource" as const,
          position: {
            x: created.posX,
            y: created.posY,
          },
          data: {
            name: created.name,
            kind: created.kind,
            status: created.status,
            metadata: created.metadata,
          },
        };
      }),

    updateResource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          resourceId: z.string().min(1),
          name: z.string().min(1).optional(),
          kind: resourceKindSchema.optional(),
          status: resourceStatusSchema.optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          position: z
            .object({
              x: z.number(),
              y: z.number(),
            })
            .optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);
        const resource = await getOwnedResource(input.resourceId, userId);

        if (resource.environment.project.id !== input.projectId) {
          throw new ORPCError("NOT_FOUND", {
            message: "Resource not found in project",
          });
        }

        const updateInput: Partial<typeof projectResource.$inferInsert> = {
          updatedAt: new Date(),
        };

        if (input.name !== undefined) {
          updateInput.name = input.name;
        }

        if (input.kind !== undefined) {
          updateInput.kind = input.kind;
        }

        if (input.status !== undefined) {
          updateInput.status = input.status;
        }

        if (input.metadata !== undefined) {
          updateInput.metadata = input.metadata;
        }

        if (input.position !== undefined) {
          updateInput.posX = input.position.x;
          updateInput.posY = input.position.y;
        }

        await db
          .update(projectResource)
          .set(updateInput)
          .where(eq(projectResource.id, input.resourceId));

        const updated = await db.query.projectResource.findFirst({
          where: eq(projectResource.id, input.resourceId),
        });

        if (!updated) {
          throw new ORPCError("NOT_FOUND", {
            message: "Resource no longer exists",
          });
        }

        return {
          id: updated.id,
          type: "resource" as const,
          position: {
            x: updated.posX,
            y: updated.posY,
          },
          data: {
            name: updated.name,
            kind: updated.kind,
            status: updated.status,
            metadata: updated.metadata,
          },
        };
      }),

    deleteResource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          resourceId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);
        const resource = await getOwnedResource(input.resourceId, userId);

        if (resource.environment.project.id !== input.projectId) {
          throw new ORPCError("NOT_FOUND", {
            message: "Resource not found in project",
          });
        }

        await db.delete(projectResource).where(eq(projectResource.id, input.resourceId));

        return { success: true as const };
      }),

    createLink: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          sourceResourceId: z.string().min(1),
          targetResourceId: z.string().min(1),
          linkType: linkTypeSchema.default("network"),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);

        const [sourceResource, targetResource] = await Promise.all([
          getOwnedResource(input.sourceResourceId, userId),
          getOwnedResource(input.targetResourceId, userId),
        ]);

        if (
          sourceResource.environment.project.id !== input.projectId ||
          targetResource.environment.project.id !== input.projectId
        ) {
          throw new ORPCError("NOT_FOUND", {
            message: "Resources do not belong to project",
          });
        }

        if (sourceResource.environmentId !== targetResource.environmentId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Cannot connect resources from different environments",
          });
        }

        const created = {
          id: createId(),
          environmentId: sourceResource.environmentId,
          sourceResourceId: sourceResource.id,
          targetResourceId: targetResource.id,
          linkType: input.linkType,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await db.insert(projectResourceLink).values(created);

        return {
          id: created.id,
          source: created.sourceResourceId,
          target: created.targetResourceId,
          data: {
            linkType: created.linkType,
          },
          type: "smoothstep" as const,
        };
      }),

    deleteLink: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          linkId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);

        const link = await getOwnedLink(input.linkId, userId);

        if (link.environment.project.id !== input.projectId) {
          throw new ORPCError("NOT_FOUND", {
            message: "Link not found in project",
          });
        }

        await db.delete(projectResourceLink).where(eq(projectResourceLink.id, input.linkId));

        return { success: true as const };
      }),

    updateViewport: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          environmentId: z.string().min(1).optional(),
          viewport: viewportSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);
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
          viewport: input.viewport,
        };
      }),

    seedStarter: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          environmentId: z.string().min(1).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);
        const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

        const existingResources = await db.query.projectResource.findMany({
          where: eq(projectResource.environmentId, environment.id),
          columns: {
            id: true,
          },
        });

        if (existingResources.length > 0) {
          return getProjectGraph(input.projectId, userId, environment.id);
        }

        const starterNodes = [
          {
            id: createId(),
            environmentId: environment.id,
            kind: "web" as const,
            name: "Web",
            status: "online" as const,
            posX: 700,
            posY: 300,
          },
          {
            id: createId(),
            environmentId: environment.id,
            kind: "api" as const,
            name: "API",
            status: "crashed" as const,
            posX: 740,
            posY: 470,
          },
          {
            id: createId(),
            environmentId: environment.id,
            kind: "worker" as const,
            name: "worker",
            status: "crashed" as const,
            posX: 430,
            posY: 390,
          },
          {
            id: createId(),
            environmentId: environment.id,
            kind: "database" as const,
            name: "MongoDB",
            status: "online" as const,
            posX: 420,
            posY: 530,
          },
          {
            id: createId(),
            environmentId: environment.id,
            kind: "cache" as const,
            name: "Redis",
            status: "online" as const,
            posX: 620,
            posY: 250,
          },
          {
            id: createId(),
            environmentId: environment.id,
            kind: "volume" as const,
            name: "redis-volume",
            status: "online" as const,
            posX: 620,
            posY: 700,
          },
        ];

        await db.insert(projectResource).values(
          starterNodes.map((node) => ({
            id: node.id,
            environmentId: node.environmentId,
            kind: node.kind,
            name: node.name,
            status: node.status,
            metadata: {},
            posX: node.posX,
            posY: node.posY,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );

        const idByName = new Map(starterNodes.map((node) => [node.name, node.id]));

        const starterLinks = [
          ["Web", "API", "network"],
          ["worker", "MongoDB", "depends_on"],
          ["API", "MongoDB", "network"],
          ["API", "Redis", "depends_on"],
          ["Redis", "redis-volume", "mounts"],
        ] as const;

        const linkRows = starterLinks
          .map(([source, target, linkType]) => {
            const sourceResourceId = idByName.get(source);
            const targetResourceId = idByName.get(target);

            if (!sourceResourceId || !targetResourceId) {
              return null;
            }

            return {
              id: createId(),
              environmentId: environment.id,
              sourceResourceId,
              targetResourceId,
              linkType,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          })
          .filter((value): value is NonNullable<typeof value> => value !== null);

        if (linkRows.length > 0) {
          await db.insert(projectResourceLink).values(linkRows);
        }

        await db
          .insert(projectViewport)
          .values({
            environmentId: environment.id,
            x: -120,
            y: -140,
            zoom: 0.85,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: projectViewport.environmentId,
            set: {
              x: -120,
              y: -140,
              zoom: 0.85,
              updatedAt: new Date(),
            },
          });

        return getProjectGraph(input.projectId, userId, environment.id);
      }),

    replaceGraph: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
          environmentId: z.string().min(1).optional(),
          graph: graphStateSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);
        const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

        const now = new Date();

        await db.transaction(async (tx) => {
          await tx
            .delete(projectResourceLink)
            .where(eq(projectResourceLink.environmentId, environment.id));
          await tx.delete(projectResource).where(eq(projectResource.environmentId, environment.id));

          if (input.graph.nodes.length > 0) {
            await tx.insert(projectResource).values(
              input.graph.nodes.map((node) => ({
                id: node.id,
                environmentId: environment.id,
                kind: node.data.kind,
                name: node.data.name,
                status: node.data.status,
                metadata: node.data.metadata,
                posX: node.position.x,
                posY: node.position.y,
                createdAt: now,
                updatedAt: now,
              })),
            );
          }

          const validNodeIds = new Set(input.graph.nodes.map((node) => node.id));
          const linksToInsert = input.graph.edges
            .filter((edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target))
            .map((edge) => ({
              id: edge.id,
              environmentId: environment.id,
              sourceResourceId: edge.source,
              targetResourceId: edge.target,
              linkType: edge.data.linkType,
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
              x: input.graph.viewport.x,
              y: input.graph.viewport.y,
              zoom: input.graph.viewport.zoom,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: projectViewport.environmentId,
              set: {
                x: input.graph.viewport.x,
                y: input.graph.viewport.y,
                zoom: input.graph.viewport.zoom,
                updatedAt: now,
              },
            });
        });

        return getProjectGraph(input.projectId, userId, environment.id);
      }),

    listProjects: protectedProcedure.handler(async ({ context }) => {
      const userId = requireUserId(context);

      return db.query.project.findMany({
        where: eq(project.ownerId, userId),
      });
    }),

    listProjectResources: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = requireUserId(context);
        await getOwnedProject(input.projectId, userId);

        const environments = await db.query.projectEnvironment.findMany({
          where: eq(projectEnvironment.projectId, input.projectId),
          columns: {
            id: true,
          },
        });

        const environmentIds = environments.map((environment) => environment.id);

        if (environmentIds.length === 0) {
          return [];
        }

        return db.query.projectResource.findMany({
          where: inArray(projectResource.environmentId, environmentIds),
        });
      }),
  },
};
