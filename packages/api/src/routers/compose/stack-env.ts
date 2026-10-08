/**
 * A compose stack's OWN variables: the values its `${VAR}` refs
 * resolve against before anything shared.
 *
 * Scope and precedence, for one stack's compose interpolation:
 *
 *   1. `stack_env_var` rows of THIS stack                     (narrowest)
 *   2. the project bag for the stack's environment (`projectEnvVar`;
 *      `${{project.X}}` and `${{environment.X}}` read the same bag)
 *   3. the file's own `${VAR:-default}`
 *
 * A child service's own `serviceEnvVar` rows sit above all three. They are
 * seeded from the interpolated file once, then owned by the operator.
 *
 * Writes default to the narrowest scope. A stack's install (wizard, manifest
 * apply, `compose.create`) writes ONLY its own rows, so two templates that both
 * want `POSTGRES_PASSWORD` can never rotate each other's credential.
 * Sharing is the explicit act: a value set on the project and NOT on the stack
 * reaches it through step 2.
 *
 * Storage contract matches `serviceEnvVar`: every value is encrypted at rest
 *; `sealed` is sticky and one-way, its plaintext decrypted only by
 * {@link loadStackEnvBag} at the deploy boundary. Read surfaces get sealed
 * rows with their ciphertext and must mask them.
 */
import type { EnvironmentId, ProjectId, ResourceId, StackEnvVarId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { projectEnvVar, stackEnvVar } from "@otterdeploy/db/schema/project";
import { and, asc, eq } from "drizzle-orm";

import { decryptForDomain } from "../../lib/crypto";
import { decryptEnvValue, decryptUnsealedEnvRows, encryptEnvValue } from "../../lib/env-crypto";
import { loadProjectEnvBag } from "../project/queries/project";

export interface StackEnvVarRow {
  id: StackEnvVarId;
  stackResourceId: ResourceId;
  key: string;
  value: string;
  isSecret: boolean;
  sealed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** One value a stack install seeds into its own bag. */
export interface StackVariableSeed {
  key: string;
  value: string;
  isSecret: boolean;
}

/** Every variable of one stack, key-ordered. Unsealed values come back
 *  plaintext; sealed rows keep their ciphertext for the caller to mask. */
export async function listStackEnvVars(stackResourceId: ResourceId): Promise<StackEnvVarRow[]> {
  const rows = await db
    .select()
    .from(stackEnvVar)
    .where(eq(stackEnvVar.stackResourceId, stackResourceId))
    .orderBy(asc(stackEnvVar.key));
  return decryptUnsealedEnvRows(rows);
}

/** One stack's variables exactly as stored (ciphertext, never decrypted).
 *  For byte comparison against the project bag; never for display. */
export async function listStoredStackEnvVars(
  stackResourceId: ResourceId,
): Promise<Array<{ key: string; value: string }>> {
  return db
    .select({ key: stackEnvVar.key, value: stackEnvVar.value })
    .from(stackEnvVar)
    .where(eq(stackEnvVar.stackResourceId, stackResourceId));
}

/**
 * The stack's variables as the `${VAR}` interpolation consumes them. This IS
 * the deploy boundary, so sealed rows are decrypted here and nowhere a read
 * API can reach.
 */
export async function loadStackEnvBag(
  stackResourceId: ResourceId,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: stackEnvVar.key, value: stackEnvVar.value, sealed: stackEnvVar.sealed })
    .from(stackEnvVar)
    .where(eq(stackEnvVar.stackResourceId, stackResourceId));
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key] = row.sealed
      ? await decryptForDomain(row.value, "env-vars")
      : await decryptEnvValue(row.value);
  }
  return out;
}

/** Encrypt a stack install's seed values into insertable rows. Empty values
 *  are dropped: an unset `${VAR}` falls through to the project bag (or the
 *  file's default), which is the explicit way to share one. */
export async function createStackVariableRows(
  stackResourceId: ResourceId,
  seeds: ReadonlyArray<StackVariableSeed>,
): Promise<Array<typeof stackEnvVar.$inferInsert>> {
  return Promise.all(
    seeds
      .filter((s) => s.key.trim() !== "" && s.value !== "")
      .map(async (s) => ({
        stackResourceId,
        key: s.key,
        value: await encryptEnvValue(s.value),
        isSecret: s.isSecret,
        sealed: false,
      })),
  );
}

/** What a write stored, as a read surface may show it: the plaintext the
 *  caller sent for an unsealed key, nothing for a sealed one. */
export interface StackEnvVarWrite {
  key: string;
  value: string;
  isSecret: boolean;
  sealed: boolean;
}

/**
 * Set one key on one stack. Re-setting a key replaces its value. Sealing is
 * sticky: once either the stored row or this call seals the key, the final
 * row is sealed.
 */
export async function upsertStackEnvVar(input: {
  stackResourceId: ResourceId;
  key: string;
  value: string;
  isSecret: boolean;
  sealed?: boolean;
}): Promise<StackEnvVarWrite> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ sealed: stackEnvVar.sealed })
      .from(stackEnvVar)
      .where(
        and(eq(stackEnvVar.stackResourceId, input.stackResourceId), eq(stackEnvVar.key, input.key)),
      )
      .limit(1)
      .for("update");
    const sealed = Boolean(existing?.sealed) || Boolean(input.sealed);
    const value = await encryptEnvValue(input.value);
    await tx
      .insert(stackEnvVar)
      .values({
        stackResourceId: input.stackResourceId,
        key: input.key,
        value,
        isSecret: input.isSecret,
        sealed,
      })
      .onConflictDoUpdate({
        target: [stackEnvVar.stackResourceId, stackEnvVar.key],
        set: { value, isSecret: input.isSecret, sealed },
      });
    return {
      key: input.key,
      value: sealed ? "" : input.value,
      isSecret: input.isSecret || sealed,
      sealed,
    };
  });
}

/** Drop one key from one stack. Idempotent. */
export async function deleteStackEnvVar(input: {
  stackResourceId: ResourceId;
  key: string;
}): Promise<void> {
  await db
    .delete(stackEnvVar)
    .where(
      and(eq(stackEnvVar.stackResourceId, input.stackResourceId), eq(stackEnvVar.key, input.key)),
    );
}

/** What one stack's `${VAR}` refs resolve against, and which of its own keys
 *  hide a same-named project variable (reported, never an error). */
export interface StackInterpolationVars {
  vars: Record<string, string>;
  /** Keys set on the stack AND on the project: the stack's value is used for
   *  this stack, the project's stays as it is for everything else. */
  shadowedProjectKeys: string[];
}

/**
 * The variable bag a stack's compose interpolation reads, layered narrowest
 * last: the project bag for the stack's environment, then the stack's own
 * variables over it. See the module doc for the full precedence.
 */
export async function loadStackInterpolationVars(input: {
  projectId: ProjectId;
  /** The stack's environment (a NULL stamp is main's, resolved by the caller). */
  environmentId: EnvironmentId | null;
  stackResourceId: ResourceId;
}): Promise<StackInterpolationVars> {
  const shared = input.environmentId
    ? await loadProjectEnvBag({ projectId: input.projectId, environmentId: input.environmentId })
    : {};
  const own = await loadStackEnvBag(input.stackResourceId);
  return {
    vars: { ...shared, ...own },
    shadowedProjectKeys: Object.keys(own)
      .filter((key) => key in shared)
      .sort(),
  };
}

/** The keys of one (project, environment) bag, values never read. For
 *  read surfaces that only need to say "the project also sets this". */
export async function listProjectEnvKeys(scope: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}): Promise<Set<string>> {
  const rows = await db
    .select({ key: projectEnvVar.key })
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, scope.projectId),
        eq(projectEnvVar.environmentId, scope.environmentId),
      ),
    );
  return new Set(rows.map((r) => r.key));
}
