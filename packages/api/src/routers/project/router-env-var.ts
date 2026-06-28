import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import {
  bulkReplaceProjectEnvVarsForOrg,
  deleteProjectEnvVarForOrg,
  listProjectEnvVarsForOrg,
  upsertProjectEnvVarForOrg,
} from "./handlers";

export const envVarRouter = {
  list: orgScopedProcedure.project.envVar.list.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    const result = await listProjectEnvVarsForOrg({
      projectId: input.projectId,
      environmentId: input.environmentId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  upsert: requirePermission({ env: ["update"] }).project.envVar.upsert.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "project", id: input.projectId },
        envKey: input.key,
      });
      const result = await upsertProjectEnvVarForOrg({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
        key: input.key,
        value: input.value,
        isSecret: input.isSecret,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  delete: requirePermission({ env: ["update"] }).project.envVar.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "project", id: input.projectId },
        envKey: input.key,
      });
      const result = await deleteProjectEnvVarForOrg({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
        key: input.key,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  bulkReplace: requirePermission({ env: ["update"] }).project.envVar.bulkReplace.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "project", id: input.projectId },
        bulkSize: input.vars.length,
      });
      const result = await bulkReplaceProjectEnvVarsForOrg({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
        vars: input.vars,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
