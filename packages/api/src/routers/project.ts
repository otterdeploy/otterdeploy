import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { projectService, DomainError } from "@otterstack/domain";

import {
  orgProcedure,
  orgAdminProcedure,
  orgOwnerProcedure,
} from "../index";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
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
      try {
        return await projectService.createProject({
          organizationId: context.organizationId,
          ownerId: context.userId,
          name: input.name,
          slug: input.slug,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  getById: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await projectService.getProjectById(input.projectId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
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
      return projectService.listProjects(context.organizationId, input.page, input.pageSize);
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
      try {
        return await projectService.updateProject({
          projectId: input.projectId,
          organizationId: context.organizationId,
          name: input.name,
          slug: input.slug,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  delete: orgOwnerProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await projectService.deleteProject(input.projectId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
