import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { and, db, eq, inArray } from "@otterstack/db";
import {
  projectEnvironment,
  projectResource,
} from "@otterstack/db/schema/architecture";
import { environmentVariable } from "@otterstack/db/schema/operations";
import { secretReference } from "@otterstack/db/schema/secrets";
import { upsertSecretReference, revealSecretByReference } from "@otterstack/secrets";

import { orgProcedure, orgMemberProcedure, orgMemberStepUpProcedure } from "../index";
import { createId } from "../utils/helpers";
import { writeAuditLogEvent } from "../utils/audit";
import { encodeLegacySecret } from "../utils/legacy-secret";
import {
  validateProjectAccess,
  validateEnvVarAccess,
  validateEnvironmentInProject,
  validateResourceInProject,
} from "../utils/ownership";

type EnvironmentVariableScope = "project" | "environment" | "resource";

type EnvironmentVariableScopeIds = {
  projectId: string;
  environmentId: string | null;
  resourceId: string | null;
};

type EnvironmentVariableSecretMeta = {
  provider: "infisical" | "native_breakglass" | null;
  providerVersion: string | null;
} | null;

function formatEnvironmentVariable(
  row: typeof environmentVariable.$inferSelect,
  projectId: string,
  environmentId: string | null,
  resourceId: string | null,
  secretMeta?: EnvironmentVariableSecretMeta,
) {
  return {
    id: row.id,
    projectId,
    environmentId,
    resourceId,
    scope: row.scope,
    key: row.key,
    isSecret: row.isSecret,
    buildTime: row.isBuildTime,
    secretReferenceId: row.secretReferenceId ?? null,
    secretProvider: secretMeta?.provider ?? null,
    secretVersion: secretMeta?.providerVersion ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function resolveEnvironmentVariableScopeIds(
  scope: string,
  scopeId: string,
): Promise<EnvironmentVariableScopeIds> {
  if (scope === "project") {
    return { projectId: scopeId, environmentId: null, resourceId: null };
  }
  if (scope === "environment") {
    const env = await db.query.projectEnvironment.findFirst({
      where: eq(projectEnvironment.id, scopeId),
    });
    return {
      projectId: env?.projectId ?? "",
      environmentId: scopeId,
      resourceId: null,
    };
  }
  if (scope === "resource") {
    const resource = await db.query.projectResource.findFirst({
      where: eq(projectResource.id, scopeId),
      with: { environment: true },
    });
    return {
      projectId: resource?.environment?.projectId ?? "",
      environmentId: resource?.environmentId ?? null,
      resourceId: scopeId,
    };
  }

  return { projectId: "", environmentId: null, resourceId: null };
}

async function resolveEnvironmentVariableInputScope(input: {
  projectId: string;
  environmentId?: string;
  resourceId?: string;
  scope: EnvironmentVariableScope;
}) {
  if (input.scope === "project") {
    return {
      scopeId: input.projectId,
      environmentId: null,
      resourceId: null,
    };
  }

  if (input.scope === "environment") {
    if (!input.environmentId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "environmentId is required for environment scope",
      });
    }
    return {
      scopeId: input.environmentId,
      environmentId: input.environmentId,
      resourceId: null,
    };
  }

  if (!input.environmentId || !input.resourceId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "environmentId and resourceId are required for resource scope",
    });
  }

  return {
    scopeId: input.resourceId,
    environmentId: input.environmentId,
    resourceId: input.resourceId,
  };
}

export const environmentVariableRouter = {
  upsert: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
        scope: z.enum(["project", "environment", "resource"]),
        key: z.string().min(1),
        value: z.string().min(1),
        isSecret: z.boolean().default(true),
        buildTime: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);
      const scope = await resolveEnvironmentVariableInputScope(input);

      if (input.scope === "environment" && scope.environmentId) {
        await validateEnvironmentInProject(
          scope.environmentId,
          input.projectId,
          context.organizationId,
        );
      }

      if (input.scope === "resource" && scope.environmentId && scope.resourceId) {
        await validateResourceInProject(
          scope.resourceId,
          scope.environmentId,
          input.projectId,
          context.organizationId,
        );
      }

      const secret = await upsertSecretReference({
        organizationId: context.organizationId,
        kind: "env_var",
        logicalScope: input.scope,
        logicalScopeId: scope.scopeId,
        key: input.key,
        plaintext: input.value,
        actorUserId: context.userId,
      });

      const existing = await db.query.environmentVariable.findFirst({
        where: and(
          eq(environmentVariable.organizationId, context.organizationId),
          eq(environmentVariable.scope, input.scope),
          eq(environmentVariable.scopeId, scope.scopeId),
          eq(environmentVariable.key, input.key),
        ),
      });

      const now = new Date();

      if (existing) {
        await db
          .update(environmentVariable)
          .set({
            secretReferenceId: secret.reference.id,
            encryptedValue: encodeLegacySecret(input.value),
            isSecret: input.isSecret,
            isBuildTime: input.buildTime,
            updatedAt: now,
          })
          .where(eq(environmentVariable.id, existing.id));

        await writeAuditLogEvent({
          organizationId: context.organizationId,
          userId: context.userId,
          action: "secret.upserted",
          entityType: "environment_variable",
          entityId: existing.id,
          metadata: {
            scope: input.scope,
            scopeId: scope.scopeId,
            key: input.key,
            secretReferenceId: secret.reference.id,
          },
          headers: context.headers,
        });

        const updated = await db.query.environmentVariable.findFirst({
          where: eq(environmentVariable.id, existing.id),
        });

        return formatEnvironmentVariable(updated!, input.projectId, scope.environmentId, scope.resourceId, {
          provider: secret.reference.provider,
          providerVersion: secret.reference.providerVersion,
        });
      }

      const row = {
        id: createId(),
        organizationId: context.organizationId,
        scope: input.scope,
        scopeId: scope.scopeId,
        key: input.key,
        secretReferenceId: secret.reference.id,
        encryptedValue: encodeLegacySecret(input.value),
        isSecret: input.isSecret,
        isBuildTime: input.buildTime,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(environmentVariable).values(row);

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "secret.upserted",
        entityType: "environment_variable",
        entityId: row.id,
        metadata: {
          scope: input.scope,
          scopeId: scope.scopeId,
          key: input.key,
          secretReferenceId: secret.reference.id,
        },
        headers: context.headers,
      });

      return formatEnvironmentVariable(
        row as typeof environmentVariable.$inferSelect,
        input.projectId,
        scope.environmentId,
        scope.resourceId,
        {
          provider: secret.reference.provider,
          providerVersion: secret.reference.providerVersion,
        },
      );
    }),

  get: orgProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateEnvVarAccess(input.variableId, context.organizationId);
      const ids = await resolveEnvironmentVariableScopeIds(row.scope, row.scopeId);

      const secretMeta = row.secretReferenceId
        ? await db.query.secretReference.findFirst({
            where: eq(secretReference.id, row.secretReferenceId),
          })
        : null;

      return formatEnvironmentVariable(row, ids.projectId, ids.environmentId, ids.resourceId, {
        provider: secretMeta?.provider ?? null,
        providerVersion: secretMeta?.providerVersion ?? null,
      });
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateProjectAccess(input.projectId, context.organizationId);

      const rows = await db.query.environmentVariable.findMany({
        where: eq(environmentVariable.organizationId, context.organizationId),
      });

      const referenceIds = rows
        .map((row) => row.secretReferenceId)
        .filter((value): value is string => !!value);

      const references =
        referenceIds.length > 0
          ? await db.query.secretReference.findMany({
              where: inArray(secretReference.id, referenceIds),
            })
          : [];

      const referenceById = new Map(references.map((reference) => [reference.id, reference]));
      const results = [];

      for (const row of rows) {
        const ids = await resolveEnvironmentVariableScopeIds(row.scope, row.scopeId);
        if (ids.projectId !== input.projectId) continue;
        if (input.environmentId && ids.environmentId !== input.environmentId) continue;
        if (input.resourceId && ids.resourceId !== input.resourceId) continue;

        const reference = row.secretReferenceId
          ? referenceById.get(row.secretReferenceId)
          : null;

        results.push(
          formatEnvironmentVariable(row, ids.projectId, ids.environmentId, ids.resourceId, {
            provider: reference?.provider ?? null,
            providerVersion: reference?.providerVersion ?? null,
          }),
        );
      }

      return results;
    }),

  delete: orgMemberProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateEnvVarAccess(input.variableId, context.organizationId);
      await db.delete(environmentVariable).where(eq(environmentVariable.id, input.variableId));

      await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "secret.deleted",
        entityType: "environment_variable",
        entityId: input.variableId,
        metadata: {},
        headers: context.headers,
      });

      return { success: true as const };
    }),

  reveal: orgMemberStepUpProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
        reason: z.string().min(1).max(256),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateEnvVarAccess(input.variableId, context.organizationId);
      if (!row.secretReferenceId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Variable has no secret reference. Backfill is required first.",
        });
      }

      const revealed = await revealSecretByReference({
        organizationId: context.organizationId,
        secretReferenceId: row.secretReferenceId,
        expectedKind: "env_var",
      });

      const revealAuditId = await writeAuditLogEvent({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "secret.revealed",
        entityType: "environment_variable",
        entityId: row.id,
        metadata: {
          reason: input.reason,
          secretReferenceId: row.secretReferenceId,
        },
        headers: context.headers,
      });

      return {
        variableId: row.id,
        value: revealed.value,
        revealedAt: new Date().toISOString(),
        revealAuditId,
        providerVersion: revealed.providerVersion,
      };
    }),
};
