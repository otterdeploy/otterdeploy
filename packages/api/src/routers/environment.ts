import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { environmentService, DomainError } from "@otterstack/domain";

import { orgProcedure, orgMemberProcedure, orgAdminProcedure } from "../index";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

export const environmentRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(64),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentService.createEnvironment({
          projectId: input.projectId,
          organizationId: context.organizationId,
          name: input.name,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  getById: orgProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentService.getEnvironmentById(input.environmentId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentService.listEnvironments(input.projectId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
    }),

  delete: orgAdminProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await environmentService.deleteEnvironment(input.environmentId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
