import { matchError } from "better-result";

import { recordSecretMapChanges } from "../../audit/changes";
import { orgScopedProcedure, requirePermission } from "../../index";
import {
  bulkReplaceProjectEnvVarsForOrg,
  deleteProjectEnvVarForOrg,
  listProjectEnvVarsForOrg,
  upsertProjectEnvVarForOrg,
} from "./handlers";

/**
 * The env-var key set before a write, for the audit diff.
 *
 * Only the NAMES are kept: `recordSecretMapChanges` is handed a key→marker map,
 * so no value (plaintext, decrypted or masked) is ever in a position to reach
 * the audit row. An unreadable project yields an empty set, which degrades the
 * diff rather than failing the write the caller is entitled to.
 */
async function envKeysBefore(
  // Derived from the reader it forwards to, so the branded ProjectId /
  // EnvironmentId / OrganizationId types flow from the call site instead of
  // being restated (and widened to string) here.
  scope: Parameters<typeof listProjectEnvVarsForOrg>[0],
): Promise<Record<string, string>> {
  const result = await listProjectEnvVarsForOrg(scope);
  if (result.isErr()) return {};
  const keys: Record<string, string> = {};
  for (const row of result.value) keys[row.key] = "set";
  return keys;
}

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
      const before = await envKeysBefore({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
      });
      const result = await upsertProjectEnvVarForOrg({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
        key: input.key,
        value: input.value,
        isSecret: input.isSecret,
        sealed: input.sealed,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      // A key that already existed reads as `replace` (its value was rewritten,
      // the rotation an auditor cares about) and a new one as `add`. The
      // marker differs from "set" precisely so an existing key produces a
      // `replace` op rather than being diffed away as unchanged.
      recordSecretMapChanges(context, {
        before,
        after: { ...before, [input.key]: "written" },
      });
      return result.value;
    },
  ),

  delete: requirePermission({ env: ["update"] }).project.envVar.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "project", id: input.projectId },
        envKey: input.key,
      });
      const before = await envKeysBefore({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
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
      const after = { ...before };
      delete after[input.key];
      recordSecretMapChanges(context, { before, after });
      return result.value;
    },
  ),

  bulkReplace: requirePermission({ env: ["update"] }).project.envVar.bulkReplace.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "project", id: input.projectId },
        bulkSize: input.vars.length,
      });
      const before = await envKeysBefore({
        projectId: input.projectId,
        environmentId: input.environmentId,
        organizationId: context.activeOrganizationId,
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
      // Every surviving key is marked `written`, so the patch shows which keys
      // this replace added, dropped, and rewrote. It cannot distinguish "rewrote
      // to the same value" from a real rotation: that would need the old and
      // new values side by side, and neither belongs in the audit row.
      const after: Record<string, string> = {};
      for (const v of input.vars) after[v.key] = "written";
      recordSecretMapChanges(context, { before, after });
      return result.value;
    },
  ),
};
