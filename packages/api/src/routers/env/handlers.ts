/**
 * Environment lifecycle.
 *
 * Envs are created standalone (no projectId) and attached to a project by
 * the subsequent `project.create` call that supplies the env's id. Org
 * scoping for reads is through `project.organizationId` via inner join —
 * standalone envs are intentionally invisible to `list` / `get` until a
 * project claims them.
 */

import { Result } from "better-result";

import { type Id, ID_PREFIX } from "@otterstack/shared/id";

import { isUniqueViolation } from "../project/views";

import {
  EnvironmentConflictError,
  EnvironmentNotFoundError,
  type EnvironmentId,
} from "./errors";
import {
  createEnvRecord,
  deleteEnvRecord,
  getEnvInOrg,
  listEnvsByOrg,
  type EnvironmentRecord,
} from "./queries";

type OrgId = Id<typeof ID_PREFIX.organization>;
type OrgRef = { organizationId: OrgId };
type ProjectId = Id<typeof ID_PREFIX.project>;

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

export async function createEnv(
  input: { id?: EnvironmentId; name: string; slug: string },
): Promise<Result<EnvironmentRecord, EnvironmentConflictError>> {
  try {
    const created = await createEnvRecord({
      id: input.id,
      name: input.name.trim(),
      slug: input.slug,
    });
    if (!created) {
      return Result.err(new EnvironmentConflictError({ slug: input.slug }));
    }
    return Result.ok(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Result.err(new EnvironmentConflictError({ slug: input.slug }));
    }
    throw error;
  }
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
