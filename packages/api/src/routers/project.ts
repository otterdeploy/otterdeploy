import * as z from "zod";
import { projectService } from "@otterdeploy/domain";

import { orgProcedure, orgAdminProcedure, orgOwnerProcedure } from "../index";
import { unwrapResult } from "../utils/result";

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
      return unwrapResult(
        await projectService.createProject({
          organizationId: context.organizationId,
          ownerId: context.userId,
          name: input.name,
          slug: input.slug,
        }),
      );
    }),

  getById: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(await projectService.getProjectById(input.projectId, context.organizationId));
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
      return unwrapResult(
        await projectService.updateProject({
          projectId: input.projectId,
          organizationId: context.organizationId,
          name: input.name,
          slug: input.slug,
        }),
      );
    }),

  delete: orgOwnerProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(await projectService.deleteProject(input.projectId, context.organizationId));
    }),
};
