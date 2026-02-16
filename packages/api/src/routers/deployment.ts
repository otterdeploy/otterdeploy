import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { deploymentService, DomainError } from "@otterstack/domain";
import { db, eq, and, or } from "@otterstack/db";
import { environmentVariable } from "@otterstack/db/schema/operations";
import { deploymentSecretSnapshot } from "@otterstack/db/schema/secrets";
import { revealSecretByReference } from "@otterstack/secrets";

import {
  orgProcedure,
  orgMemberProcedure,
  orgAdminProcedure,
} from "../index";
import { createId, paginationMeta } from "../utils/helpers";
import { decodeLegacySecret, hashSecretDigest } from "../utils/legacy-secret";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

type CreateDeploymentSecretSnapshotInput = {
  deploymentId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  resourceId: string;
};

async function createDeploymentSecretSnapshot(
  input: CreateDeploymentSecretSnapshotInput,
) {
  const rows = await db.query.environmentVariable.findMany({
    where: and(
      eq(environmentVariable.organizationId, input.organizationId),
      or(
        and(
          eq(environmentVariable.scope, "project"),
          eq(environmentVariable.scopeId, input.projectId),
        ),
        and(
          eq(environmentVariable.scope, "environment"),
          eq(environmentVariable.scopeId, input.environmentId),
        ),
        and(
          eq(environmentVariable.scope, "resource"),
          eq(environmentVariable.scopeId, input.resourceId),
        ),
      ),
    ),
  });

  const scopeWeight = {
    project: 0,
    environment: 1,
    resource: 2,
  } as const;

  const latestByKey = new Map<string, typeof environmentVariable.$inferSelect>();
  const sortedRows = rows.sort((left, right) => {
    const weightDelta = scopeWeight[left.scope] - scopeWeight[right.scope];
    if (weightDelta !== 0) return weightDelta;
    return left.updatedAt.getTime() - right.updatedAt.getTime();
  });

  for (const row of sortedRows) {
    latestByKey.set(row.key, row);
  }

  const entries = [] as Array<{
    key: string;
    variableId: string;
    scope: "project" | "environment" | "resource";
    secretReferenceId: string | null;
    providerVersion: string | null;
    digest: string;
  }>;

  for (const row of latestByKey.values()) {
    let secretValue = decodeLegacySecret(row.encryptedValue);
    let providerVersion: string | null = null;

    if (row.secretReferenceId) {
      const revealed = await revealSecretByReference({
        organizationId: input.organizationId,
        secretReferenceId: row.secretReferenceId,
        expectedKind: "env_var",
      });
      secretValue = revealed.value;
      providerVersion = revealed.providerVersion;
    }

    entries.push({
      key: row.key,
      variableId: row.id,
      scope: row.scope,
      secretReferenceId: row.secretReferenceId ?? null,
      providerVersion,
      digest: hashSecretDigest(secretValue),
    });
  }

  const snapshotHash = hashSecretDigest(
    JSON.stringify(
      [...entries].sort((left, right) => left.key.localeCompare(right.key)),
    ),
  );

  await db.insert(deploymentSecretSnapshot).values({
    id: createId(),
    deploymentId: input.deploymentId,
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    entriesJson: entries,
    snapshotHash,
    createdAt: new Date(),
  });
}

export const deploymentRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        resourceId: z.string().min(1),
        source: z.enum(["git_push", "manual", "rollback", "api", "preview"]),
        gitRef: z.string().optional(),
        gitCommitSha: z.string().optional(),
        buildMethod: z.enum(["nixpacks", "dockerfile", "buildpack"]).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        const result = await deploymentService.createDeployment({
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
          source: input.source,
          triggeredBy: context.userId,
          gitRef: input.gitRef,
          gitCommitSha: input.gitCommitSha,
          buildMethod: input.buildMethod,
        });

        await createDeploymentSecretSnapshot({
          deploymentId: result.id,
          organizationId: context.organizationId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          resourceId: input.resourceId,
        });

        return result;
      } catch (err) {
        mapDomainError(err);
      }
    }),

  getById: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        const result = await deploymentService.getDeploymentWithTimeline(
          input.deploymentId,
          context.organizationId,
        );
        return result.deployment;
      } catch (err) {
        mapDomainError(err);
      }
    }),

  list: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1).optional(),
        environmentId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(100).optional().default(10),
      }),
    )
    .handler(async ({ context, input }) => {
      return deploymentService.listDeployments({
        organizationId: context.organizationId,
        projectId: input.projectId,
        environmentId: input.environmentId,
        resourceId: input.resourceId,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  cancel: orgMemberProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentService.cancelDeployment(
          input.deploymentId,
          context.organizationId,
          context.userId,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),

  rollback: orgAdminProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await deploymentService.initiateRollback(
          input.deploymentId,
          context.organizationId,
          context.userId,
          input.reason,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),

  streamLogs: orgProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        await deploymentService.getDeploymentWithTimeline(input.deploymentId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
      return {
        items: [] as never[],
        meta: paginationMeta(1, 10, 0),
      };
    }),
};
