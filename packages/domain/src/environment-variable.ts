import { Result } from "better-result";
import { db, eq, and, inArray } from "@otterstack/db";
import { project, projectEnvironment, projectResource } from "@otterstack/db/schema/architecture";
import { environmentVariable } from "@otterstack/db/schema/operations";
import { secretReference } from "@otterstack/db/schema/secrets";
import { upsertSecretReference, revealSecretByReference } from "@otterstack/secrets";

import { NotFoundError, BadRequestError, ConflictError } from "./errors";
import { type AuditContext, writeAuditLog } from "./audit-writer";
import { encodeLegacySecret } from "./legacy-secret";

type EnvironmentVariableScope = "project" | "environment" | "resource";

type ScopeIds = {
  projectId: string;
  environmentId: string | null;
  resourceId: string | null;
};

type SecretMeta = {
  provider: "infisical" | "native_breakglass" | null;
  providerVersion: string | null;
} | null;

function formatVariable(
  row: typeof environmentVariable.$inferSelect,
  projectId: string,
  environmentId: string | null,
  resourceId: string | null,
  secretMeta?: SecretMeta,
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

async function resolveScopeIds(scope: string, scopeId: string): Promise<ScopeIds> {
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

function resolveInputScope(input: {
  projectId: string;
  environmentId?: string;
  resourceId?: string;
  scope: EnvironmentVariableScope;
}): Result<{ scopeId: string; environmentId: string | null; resourceId: string | null }, BadRequestError> {
  if (input.scope === "project") {
    return Result.ok({ scopeId: input.projectId, environmentId: null, resourceId: null });
  }
  if (input.scope === "environment") {
    if (!input.environmentId) {
      return Result.err(new BadRequestError({ field: "environmentId", message: "environmentId is required for environment scope" }));
    }
    return Result.ok({
      scopeId: input.environmentId,
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
    scopeId: input.resourceId,
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
  const row = await db.query.projectEnvironment.findFirst({
    where: and(
      eq(projectEnvironment.id, environmentId),
      eq(projectEnvironment.projectId, projectId),
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
  const row = await db.query.projectResource.findFirst({
    where: and(
      eq(projectResource.id, resourceId),
      eq(projectResource.environmentId, environmentId),
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

  const secret = await upsertSecretReference({
    organizationId: params.organizationId,
    kind: "env_var",
    logicalScope: params.scope,
    logicalScopeId: scope.scopeId,
    key: params.key,
    plaintext: params.value,
    actorUserId: params.audit.userId,
  });

  const existing = await db.query.environmentVariable.findFirst({
    where: and(
      eq(environmentVariable.organizationId, params.organizationId),
      eq(environmentVariable.scope, params.scope),
      eq(environmentVariable.scopeId, scope.scopeId),
      eq(environmentVariable.key, params.key),
    ),
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
      scopeId: scope.scopeId,
      key: params.key,
      secretReferenceId: secret.reference.id,
    });

    const updated = await db.query.environmentVariable.findFirst({
      where: eq(environmentVariable.id, existing.id),
    });

    return Result.ok(formatVariable(updated!, params.projectId, scope.environmentId, scope.resourceId, {
      provider: secret.reference.provider,
      providerVersion: secret.reference.providerVersion,
    }));
  }

  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    scope: params.scope,
    scopeId: scope.scopeId,
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
    scopeId: scope.scopeId,
    key: params.key,
    secretReferenceId: secret.reference.id,
  });

  return Result.ok(formatVariable(inserted, params.projectId, scope.environmentId, scope.resourceId, {
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
  const ids = await resolveScopeIds(row.scope, row.scopeId);

  const secretMeta = row.secretReferenceId
    ? await db.query.secretReference.findFirst({
        where: eq(secretReference.id, row.secretReferenceId),
      })
    : null;

  return Result.ok(formatVariable(row, ids.projectId, ids.environmentId, ids.resourceId, {
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

  const rows = await db.query.environmentVariable.findMany({
    where: eq(environmentVariable.organizationId, params.organizationId),
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
  const results = [];

  for (const row of rows) {
    const ids = await resolveScopeIds(row.scope, row.scopeId);
    if (ids.projectId !== params.projectId) continue;
    if (params.environmentId && ids.environmentId !== params.environmentId) continue;
    if (params.resourceId && ids.resourceId !== params.resourceId) continue;

    const reference = row.secretReferenceId ? referenceById.get(row.secretReferenceId) : null;

    results.push(
      formatVariable(row, ids.projectId, ids.environmentId, ids.resourceId, {
        provider: reference?.provider ?? null,
        providerVersion: reference?.providerVersion ?? null,
      }),
    );
  }

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
