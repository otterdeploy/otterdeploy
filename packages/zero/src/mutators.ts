import { defineMutator, defineMutators } from "@rocicorp/zero";
import * as z from "zod";

export const mutators = defineMutators({
  project: {
    create: defineMutator(
      z.object({
        id: z.string(),
        organizationId: z.string(),
        ownerId: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
      async ({ tx, ctx, args: { id, organizationId, ownerId, name, slug } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        const now = Date.now();
        await tx.mutate.project.insert({
          id,
          organizationId,
          ownerId,
          name,
          slug,
          createdAt: now,
          updatedAt: now,
        });
      },
    ),

    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        slug: z.string().optional(),
      }),
      async ({ tx, ctx, args: { id, name, slug } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.project.update({
          id,
          ...(name !== undefined && { name }),
          ...(slug !== undefined && { slug }),
          updatedAt: Date.now(),
        });
      },
    ),

    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, ctx, args: { id } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.project.update({
          id,
          deletedAt: Date.now(),
        });
      },
    ),
  },

  environment: {
    create: defineMutator(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
      }),
      async ({ tx, ctx, args: { id, projectId, name } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        const now = Date.now();
        await tx.mutate.projectEnvironment.insert({
          id,
          projectId,
          name,
          createdAt: now,
          updatedAt: now,
        });
      },
    ),

    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, ctx, args: { id } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.projectEnvironment.delete({ id });
      },
    ),
  },

  resource: {
    create: defineMutator(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        kind: z.string(),
        name: z.string(),
        posX: z.number(),
        posY: z.number(),
      }),
      async ({ tx, ctx, args: { id, environmentId, kind, name, posX, posY } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        const now = Date.now();
        await tx.mutate.projectResource.insert({
          id,
          environmentId,
          kind,
          name,
          posX,
          posY,
          createdAt: now,
          updatedAt: now,
        });
      },
    ),

    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
      }),
      async ({ tx, ctx, args: { id, name, posX, posY } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.projectResource.update({
          id,
          ...(name !== undefined && { name }),
          ...(posX !== undefined && { posX }),
          ...(posY !== undefined && { posY }),
          updatedAt: Date.now(),
        });
      },
    ),

    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, ctx, args: { id } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.projectResource.delete({ id });
      },
    ),
  },

  resourceLink: {
    create: defineMutator(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        sourceResourceId: z.string(),
        targetResourceId: z.string(),
        linkType: z.string(),
      }),
      async ({
        tx,
        ctx,
        args: { id, environmentId, sourceResourceId, targetResourceId, linkType },
      }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        const now = Date.now();
        await tx.mutate.projectResourceLink.insert({
          id,
          environmentId,
          sourceResourceId,
          targetResourceId,
          linkType,
          createdAt: now,
          updatedAt: now,
        });
      },
    ),

    delete: defineMutator(
      z.object({ id: z.string() }),
      async ({ tx, ctx, args: { id } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.projectResourceLink.delete({ id });
      },
    ),
  },

  viewport: {
    upsert: defineMutator(
      z.object({
        environmentId: z.string(),
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
      }),
      async ({ tx, ctx, args: { environmentId, x, y, zoom } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.projectViewport.upsert({
          environmentId,
          x,
          y,
          zoom,
          updatedAt: Date.now(),
        });
      },
    ),
  },
});
