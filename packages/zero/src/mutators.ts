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
        now: z.number(),
        defaultEnvironmentId: z.string(),
      }),
      async ({ tx, ctx, args: { id, organizationId, ownerId, name, slug, now, defaultEnvironmentId } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.project.insert({
          id,
          organizationId,
          ownerId,
          name,
          slug,
          createdAt: now,
          updatedAt: now,
        });
        await tx.mutate.environment.insert({
          id: defaultEnvironmentId,
          projectId: id,
          name: "production",
          slug: "production",
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
        now: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, slug, now } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.project.update({
          id,
          ...(name !== undefined && { name }),
          ...(slug !== undefined && { slug }),
          updatedAt: now,
        });
      },
    ),

    delete: defineMutator(
      z.object({ id: z.string(), now: z.number() }),
      async ({ tx, ctx, args: { id, now } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.project.update({
          id,
          deletedAt: now,
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
        now: z.number(),
      }),
      async ({ tx, ctx, args: { id, projectId, name, now } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        await tx.mutate.environment.insert({
          id,
          projectId,
          name,
          slug,
          createdAt: now,
          updatedAt: now,
        });
      },
    ),

    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, ctx, args: { id } }) => {
      if (!ctx) {
        throw new Error("Not authenticated");
      }
      await tx.mutate.environment.delete({ id });
    }),
  },

  resource: {
    create: defineMutator(
      z.object({
        id: z.string(),
        organizationId: z.string(),
        projectId: z.string(),
        environmentId: z.string(),
        kind: z.enum(["web", "api", "worker", "database", "compose"]),
        name: z.string(),
        posX: z.number(),
        posY: z.number(),
        now: z.number(),
      }),
      async ({
        tx,
        ctx,
        args: { id, organizationId, projectId, environmentId, kind, name, posX, posY, now },
      }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.resource.insert({
          id,
          organizationId,
          projectId,
          environmentId,
          kind,
          name,
          createdAt: now,
          updatedAt: now,
        });
        await tx.mutate.resourcePosition.insert({
          resourceId: id,
          posX,
          posY,
          updatedAt: now,
        });
      },
    ),

    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        now: z.number(),
      }),
      async ({ tx, ctx, args: { id, name, now } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.resource.update({
          id,
          ...(name !== undefined && { name }),
          updatedAt: now,
        });
      },
    ),

    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, ctx, args: { id } }) => {
      if (!ctx) {
        throw new Error("Not authenticated");
      }
      await tx.mutate.resource.delete({ id });
    }),
  },

  resourcePosition: {
    update: defineMutator(
      z.object({
        resourceId: z.string(),
        posX: z.number(),
        posY: z.number(),
        now: z.number(),
      }),
      async ({ tx, ctx, args: { resourceId, posX, posY, now } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.resourcePosition.update({
          resourceId,
          posX,
          posY,
          updatedAt: now,
        });
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
        now: z.number(),
      }),
      async ({ tx, ctx, args: { environmentId, x, y, zoom, now } }) => {
        if (!ctx) {
          throw new Error("Not authenticated");
        }
        await tx.mutate.viewport.upsert({
          environmentId,
          x,
          y,
          zoom,
          updatedAt: now,
        });
      },
    ),
  },
});
