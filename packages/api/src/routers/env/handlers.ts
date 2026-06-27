/**
 * Environment lifecycle.
 *
 * Envs are created standalone (no projectId) and attached to a project by
 * the subsequent `project.create` call that supplies the env's id. Org
 * scoping for reads is through `project.organizationId` via inner join —
 * standalone envs are intentionally invisible to `list` / `get` until a
 * project claims them.
 */

import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";

import { isUniqueViolation } from "../project/views";
import {
  EnvironmentConflictError,
  EnvironmentDatabaseError,
  EnvironmentNotFoundError,
} from "./errors";
import {
  createEnvRecord,
  deleteEnvRecord,
  getEnvInOrg,
  listEnvsByOrg,
  type EnvironmentRecord,
} from "./queries";

export async function listEnvs(
  input: OrgRef & { projectId?: ProjectId },
): Promise<EnvironmentRecord[]> {
  return listEnvsByOrg(input.organizationId, input.projectId);
}

export async function getEnv(
  input: { id: EnvironmentId } & OrgRef,
): Promise<Result<EnvironmentRecord, EnvironmentNotFoundError>> {
  const record = await getEnvInOrg({
    environmentId: input.id,
    organizationId: input.organizationId,
  });
  if (!record) {
    return Result.err(new EnvironmentNotFoundError({ environmentId: input.id }));
  }
  return Result.ok(record);
}

export async function createEnv(input: {
  id?: EnvironmentId;
  name: string;
  slug: string;
  projectId?: ProjectId;
}): Promise<Result<EnvironmentRecord, EnvironmentConflictError | EnvironmentDatabaseError>> {
  // The catch handler MUST return an error, never throw. Better-result wraps
  // a throwing catch as a Panic, which surfaces to the operator as the
  // unhelpful "Result.tryPromise catch handler threw" with no clue what the
  // underlying DB error was. We map the unique-violation case to a typed
  // conflict and everything else to a typed DB error carrying the cause
  // message — the router logs the cause and returns 500 with detail.
  const insert = await Result.tryPromise({
    try: () =>
      createEnvRecord({
        id: input.id,
        name: input.name.trim(),
        slug: input.slug,
        projectId: input.projectId,
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new EnvironmentConflictError({ slug: input.slug })
        : new EnvironmentDatabaseError({ cause }),
  });
  if (Result.isError(insert)) return Result.err(insert.error);
  if (!insert.value) {
    return Result.err(new EnvironmentConflictError({ slug: input.slug }));
  }
  return Result.ok(insert.value);
}

export async function deleteEnv(
  input: { id: EnvironmentId } & OrgRef,
): Promise<Result<{ ok: true }, EnvironmentNotFoundError>> {
  const deleted = await deleteEnvRecord({
    environmentId: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) {
    return Result.err(new EnvironmentNotFoundError({ environmentId: input.id }));
  }
  return Result.ok({ ok: true });
}
