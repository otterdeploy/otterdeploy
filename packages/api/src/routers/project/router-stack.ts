import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import { applyProjectStack } from "./stack-apply";
import { diffProjectStack } from "./stack-diff";
import { saveProjectStack } from "./stack-save";

// YAML stack-code editor surface — separate from the JSON manifest
// pipeline. The editor pane in the graph view reads/writes this; the
// pipeline still lands per-database extraEnv via apply for now.
export const stackRouter = {
  diff: orgScopedProcedure.project.stack.diff.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    const result = await diffProjectStack({
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),
  save: requirePermission({ project: ["update"] }).project.stack.save.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await saveProjectStack({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
        yaml: input.yaml,
        expectedVersion: input.expectedVersion,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          // The contract doesn't enumerate parse/version errors today;
          // bubble them as native Errors so orpc serializes the
          // message into the response body.
          StackParseError: (err) => new Error(err.message),
          StackVersionMismatchError: (err) => new Error(err.message),
        });
      }
      return result.value;
    },
  ),
  apply: requirePermission({ project: ["update"] }).project.stack.apply.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await applyProjectStack(
        {
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          StackNotSavedError: () => new Error("stack-not-saved"),
        });
      }
      return result.value;
    },
  ),
};
