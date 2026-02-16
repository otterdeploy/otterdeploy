import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq, and } from "@otterstack/db";
import { environmentVariable } from "@otterstack/db/schema/operations";
import {
  projectEnvironment,
  projectResource,
} from "@otterstack/db/schema/architecture";

import { orgProcedure, orgMemberProcedure } from "../index";
import { createId } from "../utils/helpers";
import { validateProjectAccess, validateEnvVarAccess } from "../utils/ownership";

// TODO: Replace with AES-256-GCM using a KMS-managed key.
// This base64 encoding is a placeholder to avoid storing raw plaintext.
function encryptValue(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

function formatEnvVar(
  row: typeof environmentVariable.$inferSelect,
  projectId: string,
  environmentId: string | null,
  resourceId: string | null,
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function resolveScopeIds(
  scope: string,
  scopeId: string,
): Promise<{ projectId: string; environmentId: string | null; resourceId: string | null }> {
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
    const res = await db.query.projectResource.findFirst({
      where: eq(projectResource.id, scopeId),
      with: { environment: true },
    });
    return {
      projectId: res?.environment?.projectId ?? "",
      environmentId: res?.environmentId ?? null,
      resourceId: scopeId,
    };
  }
  return { projectId: "", environmentId: null, resourceId: null };
}

export const environmentVariableRouter = {
  set: orgMemberProcedure
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

      let scopeId: string;
      let environmentId: string | null = null;
      let resourceId: string | null = null;

      if (input.scope === "project") {
        scopeId = input.projectId;
      } else if (input.scope === "environment") {
        if (!input.environmentId) {
          throw new ORPCError("BAD_REQUEST", { message: "environmentId required for environment scope" });
        }
        scopeId = input.environmentId;
        environmentId = input.environmentId;
      } else {
        if (!input.resourceId) {
          throw new ORPCError("BAD_REQUEST", { message: "resourceId required for resource scope" });
        }
        scopeId = input.resourceId;
        resourceId = input.resourceId;
        if (input.environmentId) environmentId = input.environmentId;
      }

      const existing = await db.query.environmentVariable.findFirst({
        where: and(
          eq(environmentVariable.scope, input.scope),
          eq(environmentVariable.scopeId, scopeId),
          eq(environmentVariable.key, input.key),
        ),
      });

      const now = new Date();

      if (existing) {
        await db
          .update(environmentVariable)
          .set({
            encryptedValue: encryptValue(input.value),
            isSecret: input.isSecret,
            isBuildTime: input.buildTime,
            updatedAt: now,
          })
          .where(eq(environmentVariable.id, existing.id));

        const updated = await db.query.environmentVariable.findFirst({
          where: eq(environmentVariable.id, existing.id),
        });
        return formatEnvVar(updated!, input.projectId, environmentId, resourceId);
      }

      const row = {
        id: createId(),
        organizationId: context.organizationId,
        scope: input.scope,
        scopeId,
        key: input.key,
        encryptedValue: input.value,
        isSecret: input.isSecret,
        isBuildTime: input.buildTime,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(environmentVariable).values(row);
      return formatEnvVar(
        row as typeof environmentVariable.$inferSelect,
        input.projectId,
        environmentId,
        resourceId,
      );
    }),

  get: orgMemberProcedure
    .input(
      z.object({
        variableId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const row = await validateEnvVarAccess(input.variableId, context.organizationId);
      const ids = await resolveScopeIds(row.scope, row.scopeId);
      return formatEnvVar(row, ids.projectId, ids.environmentId, ids.resourceId);
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

      const conditions = [eq(environmentVariable.organizationId, context.organizationId)];

      const rows = await db.query.environmentVariable.findMany({
        where: and(...conditions),
      });

      const results = [];
      for (const row of rows) {
        const ids = await resolveScopeIds(row.scope, row.scopeId);
        if (ids.projectId !== input.projectId) continue;
        if (input.environmentId && ids.environmentId !== input.environmentId) continue;
        if (input.resourceId && ids.resourceId !== input.resourceId) continue;
        results.push(formatEnvVar(row, ids.projectId, ids.environmentId, ids.resourceId));
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
      return { success: true as const };
    }),
};
