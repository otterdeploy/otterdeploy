import { Result } from "better-result";
import { db, eq, and, inArray } from "@otterdeploy/db";
import { project, environment, resource } from "@otterdeploy/db/schema/project";
import { environmentVariable } from "@otterdeploy/db/schema/operations";
import { secretReference } from "@otterdeploy/db/schema/secrets";
import { upsertSecretReference, revealSecretByReference } from "@otterdeploy/secrets";

import { NotFoundError, BadRequestError, ConflictError } from "./errors";
import { type AuditContext, writeAuditLog } from "./audit-writer";
import { encodeLegacySecret } from "./legacy-secret";

type EnvironmentVariableScope = "project" | "environment" | "resource";

type SecretMeta = {
  provider: "infisical" | "native_breakglass" | null;
  providerVersion: string | null;
} | null;

function inferScope(row: typeof environmentVariable.$inferSelect): EnvironmentVariableScope {
  if (row.resourceId) return "resource";
  if (row.environmentId) return "environment";
  return "project";
}

function formatVariable(
  row: typeof environmentVariable.$inferSelect,
  secretMeta?: SecretMeta,
) {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId ?? null,
    resourceId: row.resourceId ?? null,
    scope: inferScope(row),
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

function resolveInputScope(input: {
  projectId: string;
  environmentId?: string;
  resourceId?: string;
  scope: EnvironmentVariableScope;
}): Result<{ environmentId: string | null; resourceId: string | null }, BadRequestError> {
  if (input.scope === "project") {
    return Result.ok({ environmentId: null, resourceId: null });
  }
  if (input.scope === "environment") {
    if (!input.environmentId) {
      return Result.err(new BadRequestError({ field: "environmentId", message: "environmentId is required for environment scope" }));
    }
    return Result.ok({
      environmentId: input.environmentId,
      resourceId: null,
    });
  }
  if (!input.environmentId || !input.resourceId) {
    return Result.err(
      new BadRequestError({ field: "resourceId", message: "environmentId and resourceId are required for resource scope" }),
    );
  }
  return Result.ok({
    environmentId: input.environmentId,
    resourceId: input.resourceId,
  });
}

async function validateProject(
  projectId: string,
  organizationId: string,
): Promise<Result<typeof project.$inferSelect, NotFoundError>> {
  const row = await db.query.project.findFirst({
    where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "project", id: projectId }));
  return Result.ok(row);
}

async function validateEnvironmentInProject(
  environmentId: string,
  projectId: string,
  organizationId: string,
): Promise<Result<void, NotFoundError>> {
  const row = await db.query.environment.findFirst({
    where: and(
      eq(environment.id, environmentId),
      eq(environment.projectId, projectId),
    ),
    with: { project: true },
  });
  if (!row || row.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "environment", id: environmentId }));
  }
  return Result.ok(undefined);
}

async function validateResourceInProject(
  resourceId: string,
  environmentId: string,
  projectId: string,
  organizationId: string,
): Promise<Result<void, NotFoundError>> {
  const row = await db.query.resource.findFirst({
    where: and(
      eq(resource.id, resourceId),
      eq(resource.environmentId, environmentId),
    ),
    with: { environment: { with: { project: true } } },
  });
  if (
    !row ||
    row.environment.projectId !== projectId ||
    row.environment.project.organizationId !== organizationId
  ) {
    return Result.err(new NotFoundError({ resource: "resource", id: resourceId }));
  }
  return Result.ok(undefined);
}

async function validateEnvVar(
  variableId: string,
  organizationId: string,
): Promise<Result<typeof environmentVariable.$inferSelect, NotFoundError>> {
  const row = await db.query.environmentVariable.findFirst({
    where: and(
      eq(environmentVariable.id, variableId),
      eq(environmentVariable.organizationId, organizationId),
    ),
  });
  if (!row) return Result.err(new NotFoundError({ resource: "environment_variable", id: variableId }));
  return Result.ok(row);
}

export async function upsertEnvironmentVariable(params: {
  organizationId: string;
  projectId: string;
  environmentId?: string;
  resourceId?: string;
  scope: EnvironmentVariableScope;
  key: string;
  value: string;
  isSecret: boolean;
  buildTime: boolean;
  audit: AuditContext;
}): Promise<Result<ReturnType<typeof formatVariable>, NotFoundError | BadRequestError | ConflictError>> {
  const projResult = await validateProject(params.projectId, params.organizationId);
  if (projResult.isErr()) return projResult;

  const scopeResult = resolveInputScope(params);
  if (scopeResult.isErr()) return scopeResult;
  const scope = scopeResult.value;

  if (params.scope === "environment" && scope.environmentId) {
    const envResult = await validateEnvironmentInProject(scope.environmentId, params.projectId, params.organizationId);
    if (envResult.isErr()) return envResult;
  }

  if (params.scope === "resource" && scope.environmentId && scope.resourceId) {
    const resResult = await validateResourceInProject(scope.resourceId, scope.environmentId, params.projectId, params.organizationId);
    if (resResult.isErr()) return resResult;
  }

  const logicalScopeId = scope.resourceId ?? scope.environmentId ?? params.projectId;

  const secret = await upsertSecretReference({
    organizationId: params.organizationId,
    kind: "env_var",
    logicalScope: params.scope,
    logicalScopeId,
    key: params.key,
    plaintext: params.value,
    actorUserId: params.audit.userId,
  });

  // Build the conditions that uniquely identify this variable
  const findConditions = [
    eq(environmentVariable.organizationId, params.organizationId),
    eq(environmentVariable.projectId, params.projectId),
    eq(environmentVariable.key, params.key),
  ];
  if (scope.resourceId) {
    findConditions.push(eq(environmentVariable.resourceId, scope.resourceId));
  } else if (scope.environmentId) {
    findConditions.push(eq(environmentVariable.environmentId, scope.environmentId));
  }

  const existing = await db.query.environmentVariable.findFirst({
    where: and(...findConditions),
  });

  const now = new Date();

  if (existing) {
    await db
      .update(environmentVariable)
      .set({
        secretReferenceId: secret.reference.id,
        encryptedValue: encodeLegacySecret(params.value),
        isSecret: params.isSecret,
        isBuildTime: params.buildTime,
        updatedAt: now,
      })
      .where(eq(environmentVariable.id, existing.id));

    await writeAuditLog(params.organizationId, params.audit, "secret.upserted", "environment_variable", existing.id, {
      scope: params.scope,
      key: params.key,
      secretReferenceId: secret.reference.id,
    });

    const updated = await db.query.environmentVariable.findFirst({
      where: eq(environmentVariable.id, existing.id),
    });

    return Result.ok(formatVariable(updated!, {
      provider: secret.reference.provider,
      providerVersion: secret.reference.providerVersion,
    }));
  }

  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    projectId: params.projectId,
    environmentId: scope.environmentId,
    resourceId: scope.resourceId,
    key: params.key,
    secretReferenceId: secret.reference.id,
    encryptedValue: encodeLegacySecret(params.value),
    isSecret: params.isSecret,
    isBuildTime: params.buildTime,
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(environmentVariable).values(row).returning();
  if (!inserted) {
    return Result.err(new ConflictError({ resource: "environment_variable", detail: "Failed to create environment variable" }));
  }

  await writeAuditLog(params.organizationId, params.audit, "secret.upserted", "environment_variable", row.id, {
    scope: params.scope,
    key: params.key,
    secretReferenceId: secret.reference.id,
  });

  return Result.ok(formatVariable(inserted, {
    provider: secret.reference.provider,
    providerVersion: secret.reference.providerVersion,
  }));
}

export async function getEnvironmentVariable(
  variableId: string,
  organizationId: string,
): Promise<Result<ReturnType<typeof formatVariable>, NotFoundError>> {
  const rowResult = await validateEnvVar(variableId, organizationId);
  if (rowResult.isErr()) return rowResult;
  const row = rowResult.value;

  const secretMeta = row.secretReferenceId
    ? await db.query.secretReference.findFirst({
        where: eq(secretReference.id, row.secretReferenceId),
      })
    : null;

  return Result.ok(formatVariable(row, {
    provider: secretMeta?.provider ?? null,
    providerVersion: secretMeta?.providerVersion ?? null,
  }));
}

export async function listEnvironmentVariables(params: {
  organizationId: string;
  projectId: string;
  environmentId?: string;
  resourceId?: string;
}): Promise<Result<ReturnType<typeof formatVariable>[], NotFoundError>> {
  const projResult = await validateProject(params.projectId, params.organizationId);
  if (projResult.isErr()) return projResult;

  const conditions = [
    eq(environmentVariable.organizationId, params.organizationId),
    eq(environmentVariable.projectId, params.projectId),
  ];
  if (params.environmentId) {
    conditions.push(eq(environmentVariable.environmentId, params.environmentId));
  }
  if (params.resourceId) {
    conditions.push(eq(environmentVariable.resourceId, params.resourceId));
  }

  const rows = await db.query.environmentVariable.findMany({
    where: and(...conditions),
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

  const referenceById = new Map(references.map((ref) => [ref.id, ref]));

  const results = rows.map((row) => {
    const reference = row.secretReferenceId ? referenceById.get(row.secretReferenceId) : null;
    return formatVariable(row, {
      provider: reference?.provider ?? null,
      providerVersion: reference?.providerVersion ?? null,
    });
  });

  return Result.ok(results);
}

export async function deleteEnvironmentVariable(
  variableId: string,
  organizationId: string,
  audit: AuditContext,
): Promise<Result<{ success: true }, NotFoundError>> {
  const rowResult = await validateEnvVar(variableId, organizationId);
  if (rowResult.isErr()) return rowResult;

  await db.delete(environmentVariable).where(eq(environmentVariable.id, variableId));

  await writeAuditLog(organizationId, audit, "secret.deleted", "environment_variable", variableId, {});

  return Result.ok({ success: true as const });
}

export async function revealEnvironmentVariable(params: {
  variableId: string;
  organizationId: string;
  reason: string;
  audit: AuditContext;
}): Promise<Result<Record<string, unknown>, NotFoundError | BadRequestError>> {
  const rowResult = await validateEnvVar(params.variableId, params.organizationId);
  if (rowResult.isErr()) return rowResult;
  const row = rowResult.value;

  if (!row.secretReferenceId) {
    return Result.err(
      new BadRequestError({ field: "secretReferenceId", message: "Variable has no secret reference. Backfill is required first." }),
    );
  }

  const revealed = await revealSecretByReference({
    organizationId: params.organizationId,
    secretReferenceId: row.secretReferenceId,
    expectedKind: "env_var",
  });

  const revealAuditId = await writeAuditLog(
    params.organizationId,
    params.audit,
    "secret.revealed",
    "environment_variable",
    row.id,
    {
      reason: params.reason,
      secretReferenceId: row.secretReferenceId,
    },
  );

  return Result.ok({
    variableId: row.id,
    value: revealed.value,
    revealedAt: new Date().toISOString(),
    revealAuditId,
    providerVersion: revealed.providerVersion,
  });
}
