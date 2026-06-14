import { matchError } from "better-result";

import { orgScopedProcedure } from "../..";
import {
  enforceEnvScope,
  enforceProjectScope,
} from "../../authz/project-scope-guards";

import { createEnv, deleteEnv, getEnv, listEnvs } from "./handlers";

export const envRouter = {
  list: orgScopedProcedure.env.list.handler(async ({ input, context }) => {
    await enforceProjectScope(context, input?.projectId);
    return listEnvs({
      organizationId: context.activeOrganizationId,
      projectId: input?.projectId,
    });
  }),

  get: orgScopedProcedure.env.get.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "environment", id: input.id } });
      await enforceEnvScope(context, input.id);
      const result = await getEnv({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          EnvironmentNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  create: orgScopedProcedure.env.create.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "environment" } });
      await enforceProjectScope(context, input.projectId);
      const result = await createEnv(input);
      if (result.isErr()) {
        throw matchError(result.error, {
          EnvironmentConflictError: () => errors.CONFLICT(),
          EnvironmentDatabaseError: (err) => {
            // Log the actual cause to the operator stream so apps/server
            // shows what the DB rejected (FK violation, missing column,
            // bad slug, etc.) — the client only sees a generic 500.
            context.log.set({
              database: {
                cause: err.cause,
                code: err.pgCode,
                detail: err.pgDetail,
                constraint: err.pgConstraint,
                table: err.pgTable,
              },
            });
            return errors.INTERNAL_SERVER_ERROR({
              data: { cause: err.cause },
            });
          },
        });
      }
      context.log.set({ target: { type: "environment", id: result.value.id } });
      return result.value;
    },
  ),

  delete: orgScopedProcedure.env.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "environment", id: input.id } });
      await enforceEnvScope(context, input.id);
      const result = await deleteEnv({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          EnvironmentNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
