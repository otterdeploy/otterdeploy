import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { getCurrentState, applyChangeset, ResourceConfigSchema } from "@otterdeploy/infra-config";
import type { CurrentState, Changeset } from "@otterdeploy/infra-config";

import { orgProcedure, orgAdminProcedure } from "../index";

// ---------- Serialization helpers ----------

/** Convert CurrentState (Maps) → plain objects for JSON transport */
function serializeState(state: CurrentState) {
  const environments: Record<
    string,
    {
      id: string;
      name: string;
      resources: Record<string, unknown>;
      links: unknown[];
      envVars: unknown[];
      domains: unknown[];
    }
  > = {};

  for (const [envName, env] of state.environments) {
    const resources: Record<string, unknown> = {};
    for (const [resName, res] of env.resources) {
      resources[resName] = res;
    }
    environments[envName] = {
      id: env.id,
      name: env.name,
      resources,
      links: env.links,
      envVars: env.envVars,
      domains: env.domains,
    };
  }

  return {
    project: state.project,
    environments,
  };
}

// ---------- Zod schemas for changeset actions ----------

const CreateProjectActionSchema = z.object({
  type: z.literal("create_project"),
  name: z.string(),
  slug: z.string(),
});

const CreateEnvironmentActionSchema = z.object({
  type: z.literal("create_environment"),
  name: z.string(),
  projectId: z.string(),
});

const DeleteEnvironmentActionSchema = z.object({
  type: z.literal("delete_environment"),
  name: z.string(),
  id: z.string(),
});

const CreateResourceActionSchema = z.object({
  type: z.literal("create_resource"),
  env: z.string(),
  name: z.string(),
  config: ResourceConfigSchema,
});

const UpdateResourceActionSchema = z.object({
  type: z.literal("update_resource"),
  env: z.string(),
  name: z.string(),
  id: z.string(),
  changes: ResourceConfigSchema.partial(),
});

const DeleteResourceActionSchema = z.object({
  type: z.literal("delete_resource"),
  env: z.string(),
  name: z.string(),
  id: z.string(),
});

const CreateLinkActionSchema = z.object({
  type: z.literal("create_link"),
  env: z.string(),
  from: z.string(),
  to: z.string(),
  linkType: z.string(),
});

const DeleteLinkActionSchema = z.object({
  type: z.literal("delete_link"),
  env: z.string(),
  id: z.string(),
  from: z.string(),
  to: z.string(),
});

const SetEnvVarActionSchema = z.object({
  type: z.literal("set_env_var"),
  env: z.string(),
  resource: z.string(),
  key: z.string(),
  value: z.string(),
});

const DeleteEnvVarActionSchema = z.object({
  type: z.literal("delete_env_var"),
  env: z.string(),
  resource: z.string(),
  key: z.string(),
  id: z.string(),
});

const SetDomainActionSchema = z.object({
  type: z.literal("set_domain"),
  env: z.string(),
  resource: z.string(),
  domain: z.string(),
});

const RemoveDomainActionSchema = z.object({
  type: z.literal("remove_domain"),
  env: z.string(),
  resource: z.string(),
  domain: z.string(),
  id: z.string(),
});

const ChangeActionSchema = z.discriminatedUnion("type", [
  CreateProjectActionSchema,
  CreateEnvironmentActionSchema,
  DeleteEnvironmentActionSchema,
  CreateResourceActionSchema,
  UpdateResourceActionSchema,
  DeleteResourceActionSchema,
  CreateLinkActionSchema,
  DeleteLinkActionSchema,
  SetEnvVarActionSchema,
  DeleteEnvVarActionSchema,
  SetDomainActionSchema,
  RemoveDomainActionSchema,
]);

const ChangesetSchema = z.object({
  actions: z.array(ChangeActionSchema),
  summary: z.object({
    create: z.number(),
    update: z.number(),
    delete: z.number(),
    unchanged: z.number(),
  }),
});

// ---------- Router ----------

export const infraRouter = {
  getState: orgProcedure
    .input(
      z.object({
        projectSlug: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await getCurrentState(context.organizationId, input.projectSlug);

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }

      return serializeState(result.value);
    }),

  applyChangeset: orgAdminProcedure
    .input(
      z.object({
        projectSlug: z.string().min(1),
        changeset: ChangesetSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      // Fetch current state to build reconciler context
      const stateResult = await getCurrentState(context.organizationId, input.projectSlug);

      if (stateResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: stateResult.error.message,
        });
      }

      const currentState = stateResult.value;

      // Build context maps from current state
      const environmentIds = new Map<string, string>();
      const resourceIds = new Map<string, string>();

      for (const [envName, env] of currentState.environments) {
        environmentIds.set(envName, env.id);
        for (const [resName, res] of env.resources) {
          resourceIds.set(`${envName}:${resName}`, res.id);
        }
      }

      const result = await applyChangeset(input.changeset, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        projectId: currentState.project?.id ?? null,
        environmentIds,
        resourceIds,
      });

      if (result.isErr()) {
        const err = result.error;
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: err.message,
          data: {
            failedActionType: err.failedActionType,
            completedCount: err.completedCount,
          },
        });
      }

      return result.value;
    }),
};
