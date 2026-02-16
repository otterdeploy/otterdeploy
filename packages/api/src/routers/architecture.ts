import { ORPCError } from "@orpc/server";
import {
  project,
  projectEnvironment,
  projectResource,
  projectResourceLink,
  projectViewport,
} from "@otterstack/db/schema/architecture";
import { and, eq, inArray } from "@otterstack/db";
import { createInsertSchema } from "drizzle-zod";

import { db } from "@otterstack/db";

import { protectedProcedure } from "../index";

const projectInsertSchema = createInsertSchema(project);
const projectEnvironmentInsertSchema = createInsertSchema(projectEnvironment);
const projectResourceInsertSchema = createInsertSchema(projectResource);
const projectResourceLinkInsertSchema = createInsertSchema(projectResourceLink);
const projectViewportInsertSchema = createInsertSchema(projectViewport);

const projectCreateInputSchema = projectInsertSchema
  .pick({
    name: true,
    slug: true,
  })
  .partial({ slug: true });

const projectIdInputSchema = projectEnvironmentInsertSchema.pick({
  projectId: true,
});

const optionalEnvironmentIdInputSchema = projectViewportInsertSchema
  .pick({
    environmentId: true,
  })
  .partial({ environmentId: true });

const projectEnvironmentScopeInputSchema = projectIdInputSchema.merge(
  optionalEnvironmentIdInputSchema,
);

const resourceCreateInputSchema = projectEnvironmentScopeInputSchema.merge(
  projectResourceInsertSchema
    .pick({
      name: true,
      kind: true,
      status: true,
      metadata: true,
      posX: true,
      posY: true,
    })
    .partial({
      status: true,
      metadata: true,
    }),
);

const resourceUpdateInputSchema = projectIdInputSchema.merge(
  projectResourceInsertSchema
    .pick({
      id: true,
      name: true,
      kind: true,
      status: true,
      metadata: true,
      posX: true,
      posY: true,
    })
    .partial({
      name: true,
      kind: true,
      status: true,
      metadata: true,
      posX: true,
      posY: true,
    }),
);

const resourceDeleteInputSchema = projectIdInputSchema.merge(
  projectResourceInsertSchema.pick({
    id: true,
  }),
);

const linkCreateInputSchema = projectIdInputSchema.merge(
  projectResourceLinkInsertSchema
    .pick({
      sourceResourceId: true,
      targetResourceId: true,
      linkType: true,
    })
    .partial({ linkType: true }),
);

const linkDeleteInputSchema = projectIdInputSchema.merge(
  projectResourceLinkInsertSchema.pick({
    id: true,
  }),
);

const viewportUpdateInputSchema = projectEnvironmentScopeInputSchema.merge(
  projectViewportInsertSchema.pick({
    x: true,
    y: true,
    zoom: true,
  }),
);

const replaceGraphInputSchema = projectEnvironmentScopeInputSchema.extend({
  resources: projectResourceInsertSchema
    .pick({
      id: true,
      kind: true,
      name: true,
      status: true,
      metadata: true,
      posX: true,
      posY: true,
    })
    .array(),
  links: projectResourceLinkInsertSchema
    .pick({
      id: true,
      sourceResourceId: true,
      targetResourceId: true,
      linkType: true,
    })
    .array(),
  viewport: projectViewportInsertSchema.pick({
    x: true,
    y: true,
    zoom: true,
  }),
});

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
      .input(projectCreateInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;

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
      .input(projectIdInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
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
      .input(projectEnvironmentScopeInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;

        return getProjectGraph(input.projectId, userId, input.environmentId);
      }),

    createResource: protectedProcedure
      .input(resourceCreateInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
        await getOwnedProject(input.projectId, userId);
        const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

        const created = {
          id: createId(),
          environmentId: environment.id,
          kind: input.kind,
          name: input.name,
          status: input.status ?? "unknown",
          metadata: input.metadata ?? {},
          posX: input.posX,
          posY: input.posY,
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
      .input(resourceUpdateInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
        await getOwnedProject(input.projectId, userId);
        const resource = await getOwnedResource(input.id, userId);

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

        if (input.posX !== undefined) {
          updateInput.posX = input.posX;
        }

        if (input.posY !== undefined) {
          updateInput.posY = input.posY;
        }

        await db
          .update(projectResource)
          .set(updateInput)
          .where(eq(projectResource.id, input.id));

        const updated = await db.query.projectResource.findFirst({
          where: eq(projectResource.id, input.id),
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
      .input(resourceDeleteInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
        await getOwnedProject(input.projectId, userId);
        const resource = await getOwnedResource(input.id, userId);

        if (resource.environment.project.id !== input.projectId) {
          throw new ORPCError("NOT_FOUND", {
            message: "Resource not found in project",
          });
        }

        await db.delete(projectResource).where(eq(projectResource.id, input.id));

        return { success: true as const };
      }),

    createLink: protectedProcedure
      .input(linkCreateInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
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
          linkType: input.linkType ?? "network",
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
      .input(linkDeleteInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
        await getOwnedProject(input.projectId, userId);

        const link = await getOwnedLink(input.id, userId);

        if (link.environment.project.id !== input.projectId) {
          throw new ORPCError("NOT_FOUND", {
            message: "Link not found in project",
          });
        }

        await db.delete(projectResourceLink).where(eq(projectResourceLink.id, input.id));

        return { success: true as const };
      }),

    updateViewport: protectedProcedure
      .input(viewportUpdateInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
        await getOwnedProject(input.projectId, userId);
        const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

        await db
          .insert(projectViewport)
          .values({
            environmentId: environment.id,
            x: input.x,
            y: input.y,
            zoom: input.zoom,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: projectViewport.environmentId,
            set: {
              x: input.x,
              y: input.y,
              zoom: input.zoom,
              updatedAt: new Date(),
            },
          });

        return {
          environmentId: environment.id,
          viewport: {
            x: input.x,
            y: input.y,
            zoom: input.zoom,
          },
        };
      }),

    seedStarter: protectedProcedure
      .input(projectEnvironmentScopeInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
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
      .input(replaceGraphInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
        await getOwnedProject(input.projectId, userId);
        const environment = await getOrCreateEnvironment(input.projectId, input.environmentId);

        const now = new Date();

        await db.transaction(async (tx) => {
          await tx
            .delete(projectResourceLink)
            .where(eq(projectResourceLink.environmentId, environment.id));
          await tx.delete(projectResource).where(eq(projectResource.environmentId, environment.id));

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

          const validNodeIds = new Set(input.resources.map((resource) => resource.id));
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

        return getProjectGraph(input.projectId, userId, environment.id);
      }),

    listProjects: protectedProcedure.handler(async ({ context }) => {
      const userId = context.userId;

      return db.query.project.findMany({
        where: eq(project.ownerId, userId),
      });
    }),

    listProjectResources: protectedProcedure
      .input(projectIdInputSchema)
      .handler(async ({ context, input }) => {
        const userId = context.userId;
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
