/**
 * Environment lifecycle.
 *
 * Envs are created standalone (no projectId) and attached to a project by
 * the subsequent `project.create` call that supplies the env's id. Org
 * scoping for reads is through `project.organizationId` via inner join.
 * Standalone envs are intentionally invisible to `list` / `get` until a
 * project claims them.
 */

import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { OrgRef } from "../scopes";

import {
  dropEnvironmentOverlay,
  ensureEnvironmentOverlay,
} from "../../lib/environment/mirror-apply";
import { isUniqueViolation } from "../project/views";
import {
  EnvironmentConflictError,
  EnvironmentDatabaseError,
  EnvironmentNotEmptyError,
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
  /** Needed to reach the project's manifest for the mirror overlay. */
  organizationId?: OrganizationId;
}): Promise<Result<EnvironmentRecord, EnvironmentConflictError | EnvironmentDatabaseError>> {
  // The catch handler MUST return an error, never throw. Better-result wraps
  // a throwing catch as a Panic, which surfaces to the operator as the
  // unhelpful "Result.tryPromise catch handler threw" with no clue what the
  // underlying DB error was. We map the unique-violation case to a typed
  // conflict and everything else to a typed DB error carrying the cause
  // message: the router logs the cause and returns 500 with detail.
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
  // Give the environment its mirror: an EMPTY `environments.<slug>` overlay,
  // which resolves to a manifest identical to base and keeps tracking it. Only
  // meaningful once the env is attached to a project. A standalone env has no
  // manifest to overlay onto yet.
  if (input.projectId && input.organizationId) {
    await ensureEnvironmentOverlay(
      { projectId: input.projectId, organizationId: input.organizationId },
      input.slug,
    );
  }
  return Result.ok(insert.value);
}

/**
 * Delete an environment.
 *
 * Refuses a non-empty environment unless `cascade` is set. The refusal is the
 * point: a resource whose `environment_id` no longer resolves matches no scope
 * query at all (not base, not any live environment) so it disappears from
 * every list and graph while its container keeps running. The operator confirms
 * what will be destroyed, and only then does the delete take the resources with
 * it.
 */
export async function deleteEnv(
  input: { id: EnvironmentId; cascade?: boolean } & OrgRef,
): Promise<Result<{ ok: true }, EnvironmentNotFoundError | EnvironmentNotEmptyError>> {
  // Read the row BEFORE deleting: afterwards there is no way to learn its slug
  // or project, and both are needed to find the overlay.
  const owned = await getEnvInOrg({
    environmentId: input.id,
    organizationId: input.organizationId,
  });
  const deleted = await deleteEnvRecord({
    environmentId: input.id,
    organizationId: input.organizationId,
    cascade: input.cascade,
  });
  if (!deleted.ok) {
    return deleted.reason === "has-resources"
      ? Result.err(new EnvironmentNotEmptyError({ environmentId: input.id }))
      : Result.err(new EnvironmentNotFoundError({ environmentId: input.id }));
  }
  // Drop the overlay too. Left behind it is inert, but re-creating an
  // environment with the same slug would silently inherit the deleted one's
  // overrides: a "new" environment that is not a clean mirror, with nothing
  // on screen explaining why.
  if (owned?.projectId) {
    await dropEnvironmentOverlay(
      { projectId: owned.projectId, organizationId: input.organizationId },
      owned.slug,
    );
  }
  return Result.ok({ ok: true });
}
