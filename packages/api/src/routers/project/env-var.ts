/**
 * Org-checked wrappers around the project env-var queries. Every handler
 * first verifies the project belongs to the calling org (via
 * `getProjectInOrg`) so a stray `projectId` can't read or write a row in
 * a sibling tenant's bag. The queries themselves accept a raw Scope and
 * don't enforce tenancy.
 *
 * Sealed variables: `listProjectEnvVarsForOrg` is the API/UI-facing read
 * path, so it masks `value` to `""` for any row with `sealed: true`: the
 * ciphertext-or-plaintext behind a sealed var must never reach an RPC
 * response. The query layer (`./queries/project-env`) still returns the raw
 * stored value because the deploy-time resolver needs it to decrypt.
 */

import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import { ProjectNotFoundError } from "./errors";
import {
  bulkReplaceProjectEnvVars as bulkReplaceProjectEnvVarsQuery,
  deleteProjectEnvVar as deleteProjectEnvVarQuery,
  getProjectInOrg,
  listProjectEnvVars as listProjectEnvVarsQuery,
  upsertProjectEnvVar as upsertProjectEnvVarQuery,
  type ProjectEnvVarRow,
} from "./queries";

interface ProjectEnvScope {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  organizationId: OrganizationId;
}

async function verifyProjectOwnership(
  scope: ProjectEnvScope,
): Promise<Result<true, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  }
  return Result.ok(true);
}

/** Never returns a sealed row's real value. Masked to "" here so no caller
 *  of this handler can accidentally leak it by forgetting to mask. */
function maskSealed(row: ProjectEnvVarRow): ProjectEnvVarRow {
  return row.sealed ? { ...row, value: "" } : row;
}

export async function listProjectEnvVarsForOrg(
  scope: ProjectEnvScope,
): Promise<Result<ProjectEnvVarRow[], ProjectNotFoundError>> {
  const own = await verifyProjectOwnership(scope);
  if (own.isErr()) return Result.err(own.error);
  const rows = await listProjectEnvVarsQuery({
    projectId: scope.projectId,
    environmentId: scope.environmentId,
  });
  return Result.ok(rows.map(maskSealed));
}

export async function upsertProjectEnvVarForOrg(
  input: ProjectEnvScope & { key: string; value: string; isSecret?: boolean; sealed?: boolean },
): Promise<Result<ProjectEnvVarRow, ProjectNotFoundError>> {
  const own = await verifyProjectOwnership(input);
  if (own.isErr()) return Result.err(own.error);
  const row = await upsertProjectEnvVarQuery({
    scope: { projectId: input.projectId, environmentId: input.environmentId },
    key: input.key,
    value: input.value,
    isSecret: input.isSecret,
    sealed: input.sealed,
  });
  // The just-written row's `value` is the caller's own plaintext echoed
  // back on a normal write, but once sealed, the RETURNED row must mask
  // it too (the caller already knows what they just set; the response
  // shouldn't become a "reveal" oracle for a value that was previously
  // sealed and this call merely REPLACED, or for the ciphertext itself).
  return Result.ok(maskSealed(row));
}

export async function deleteProjectEnvVarForOrg(
  input: ProjectEnvScope & { key: string },
): Promise<Result<{ ok: boolean }, ProjectNotFoundError>> {
  const own = await verifyProjectOwnership(input);
  if (own.isErr()) return Result.err(own.error);
  await deleteProjectEnvVarQuery({
    scope: { projectId: input.projectId, environmentId: input.environmentId },
    key: input.key,
  });
  return Result.ok({ ok: true });
}

export async function bulkReplaceProjectEnvVarsForOrg(
  input: ProjectEnvScope & {
    vars: ReadonlyArray<{ key: string; value: string; isSecret?: boolean }>;
  },
): Promise<Result<ProjectEnvVarRow[], ProjectNotFoundError>> {
  const own = await verifyProjectOwnership(input);
  if (own.isErr()) return Result.err(own.error);
  const rows = await bulkReplaceProjectEnvVarsQuery(
    { projectId: input.projectId, environmentId: input.environmentId },
    input.vars,
  );
  return Result.ok(rows.map(maskSealed));
}
