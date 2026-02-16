import * as z from "zod";
import { environmentService } from "@otterstack/domain";

import { orgProcedure, orgMemberProcedure, orgAdminProcedure } from "../index";
import { fromPromise } from "../utils/result";

export const environmentRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(64),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        environmentService.createEnvironment({
          projectId: input.projectId,
          organizationId: context.organizationId,
          name: input.name,
        }),
      );
    }),

  getById: orgProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        environmentService.getEnvironmentById(input.environmentId, context.organizationId),
      );
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        environmentService.listEnvironments(input.projectId, context.organizationId),
      );
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        environmentService.deleteEnvironment(input.environmentId, context.organizationId),
      );
    }),
};
