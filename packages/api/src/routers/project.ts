import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq, and, desc, sql } from "@otterstack/db";
import {
  project,
  projectEnvironment,
  projectViewport,
} from "@otterstack/db/schema/architecture";

import {
  orgProcedure,
  orgAdminProcedure,
  orgOwnerProcedure,
} from "../index";
import {
  createId,
  generateUniqueSlug,
  paginationMeta,
} from "../utils/helpers";
import { validateProjectAccess } from "../utils/ownership";

function formatProject(row: typeof project.$inferSelect) {
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

export const projectRouter = {
  create: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().min(1).max(128),
        slug: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const organizationId = context.organizationId;

      const slug = await generateUniqueSlug(input.slug ?? input.name, async (candidate) => {
        const existing = await db.query.project.findFirst({
          where: and(eq(project.organizationId, organizationId), eq(project.slug, candidate)),
        });
        return !!existing;
      });

      const now = new Date();
      const newProject = {
        id: createId(),
        organizationId,
        ownerId: context.userId,
        name: input.name,
        slug,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(project).values(newProject);

      const environment = {
        id: createId(),
        projectId: newProject.id,
        name: "production",
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(projectEnvironment).values(environment);

      await db.insert(projectViewport).values({
        environmentId: environment.id,
        x: 0,
        y: 0,
        zoom: 1,
        updatedAt: now,
      });

      return formatProject({ ...newProject, deletedAt: null });
    }),

  getById: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateProjectAccess(input.projectId, context.organizationId);
      return formatProject(row);
    }),

  list: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;
      const organizationId = context.organizationId;

      const [items, [countRow]] = await Promise.all([
        db.query.project.findMany({
          where: eq(project.organizationId, organizationId),
          orderBy: [desc(project.createdAt)],
          limit: pageSize,
          offset,
        }),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(project)
          .where(eq(project.organizationId, organizationId)),
      ]);

      return {
        items: items.map(formatProject),
        meta: paginationMeta(page, pageSize, countRow?.count ?? 0),
      };
    }),

  update: orgAdminProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(128).optional(),
        slug: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);

      const updates: Partial<typeof project.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.slug !== undefined) {
        const existing = await db.query.project.findFirst({
          where: and(
            eq(project.organizationId, context.organizationId),
            eq(project.slug, input.slug),
          ),
        });
        if (existing && existing.id !== input.projectId) {
          throw new ORPCError("CONFLICT", { message: "Slug already in use" });
        }
        updates.slug = input.slug;
      }

      await db.update(project).set(updates).where(eq(project.id, input.projectId));

      const updated = await db.query.project.findFirst({
        where: eq(project.id, input.projectId),
      });
      if (!updated) throw new ORPCError("NOT_FOUND", { message: "Project not found" });

      return formatProject(updated);
    }),

  delete: orgOwnerProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);
      await db.delete(project).where(eq(project.id, input.projectId));
      return { success: true as const };
    }),
};
