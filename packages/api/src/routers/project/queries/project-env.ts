/**
 * Project-scoped env var CRUD.
 *
 * Rows in `projectEnvVar` back the magic `${{project.X}}` and
 * `${{environment.X}}` references the variable resolver expands at
 * deploy time. Storage is keyed by (projectId, environmentId, key) so
 * the same KEY can carry different values across environments. Each
 * row IS a per-environment value.
 *
 * Sealed variables: when `sealed` is true, `value` holds a v2 ciphertext
 * envelope (domain "env-vars", packages/api/src/lib/crypto.ts), never
 * plaintext. Sealing is one-way and sticky (see `upsertProjectEnvVar`)
 * and `bulkReplaceProjectEnvVars` deliberately never deletes or overwrites
 * a sealed row (the bulk "Save all" editor can't round-trip a plaintext it
 * was never shown). Callers that surface rows to the API/UI (this module's
 * `handlers.ts`) MUST mask `value` for sealed rows before returning them.
 * This module returns the raw stored value (ciphertext for sealed rows)
 * because the resolver needs it to decrypt at deploy/injection time.
 */

import type { EnvironmentId, ProjectEnvVarId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { projectEnvVar } from "@otterdeploy/db/schema/project";
import { and, asc, eq } from "drizzle-orm";

import { decryptUnsealedEnvRows, encryptEnvValue } from "../../../lib/env-crypto";
export interface ProjectEnvVarRow {
  id: ProjectEnvVarId;
  projectId: ProjectId;
  environmentId: EnvironmentId;
  key: string;
  value: string;
  isSecret: boolean;
  sealed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Scope {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}

/**
 * List every env var attached to a (project, environment), key-ordered.
 * Used by the UI's Shared variables tab (via the org-scoped handler, which
 * masks sealed values) and by the resolver's `loadProjectEnvBag` (which
 * decrypts sealed values itself, then flattens to Record<string,string>).
 */
export async function listProjectEnvVars(scope: Scope): Promise<ProjectEnvVarRow[]> {
  const rows = await db
    .select()
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, scope.projectId),
        eq(projectEnvVar.environmentId, scope.environmentId),
      ),
    )
    .orderBy(asc(projectEnvVar.key));
  // Encrypted at rest (od-3pp7): unsealed values come back plaintext, sealed
  // rows keep ciphertext (masked by the org-scoped handler as before).
  return decryptUnsealedEnvRows(rows);
}

/**
 * Upsert one key. The unique index on (projectId, environmentId, key)
 * is the natural conflict target. Re-setting an existing key is a
 * value replacement, not an error.
 *
 * Sealing is sticky and one-way: if the existing row (or this call) marks
 * the key sealed, the FINAL row is sealed. A caller can never flip it back
 * to unsealed by omitting `sealed: true` on a later write. `value` is
 * encrypted with the "env-vars" domain key whenever the final state is
 * sealed, whether or not THIS call's input already knew that.
 *
 * `onlyIfAbsent` makes the write a SEED: an existing key keeps its value and
 * is returned unchanged. Project variables are one flat namespace shared by
 * every stack in the project, and template variable names are generic
 * (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY`), so an unconditional
 * write from one stack's install silently rotates a credential another
 * stack is running on. Worse, the rotation is invisible: a database that
 * already has a data directory ignores `POSTGRES_PASSWORD` entirely
 * ("Skipping initialization"), so every config surface shows the new value
 * and the only authority — the volume — still holds the old one. See
 * od-esjx; this flag is the half of the fix that does not need a migration.
 */
export async function upsertProjectEnvVar(input: {
  scope: Scope;
  key: string;
  value: string;
  isSecret?: boolean;
  sealed?: boolean;
  /** Seed semantics: leave an existing key alone. Default false (replace). */
  onlyIfAbsent?: boolean;
}): Promise<ProjectEnvVarRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ sealed: projectEnvVar.sealed })
      .from(projectEnvVar)
      .where(
        and(
          eq(projectEnvVar.projectId, input.scope.projectId),
          eq(projectEnvVar.environmentId, input.scope.environmentId),
          eq(projectEnvVar.key, input.key),
        ),
      )
      .limit(1);

    // Seed-only and the key is already there: hand back what is stored rather
    // than replacing it. Read through the same decrypt path the list query
    // uses, so the caller cannot tell a seed-skip from a seed-write.
    if (input.onlyIfAbsent && existing) {
      const [current] = await tx
        .select()
        .from(projectEnvVar)
        .where(
          and(
            eq(projectEnvVar.projectId, input.scope.projectId),
            eq(projectEnvVar.environmentId, input.scope.environmentId),
            eq(projectEnvVar.key, input.key),
          ),
        )
        .limit(1);
      if (current) {
        const [decrypted] = await decryptUnsealedEnvRows([current]);
        if (decrypted) return decrypted;
      }
    }

    const sealed = Boolean(existing?.sealed) || Boolean(input.sealed);
    // Encrypt-at-rest for every row (od-3pp7), not just sealed ones. The
    // sealed flag now only governs READ behavior (write-only masking).
    const value = await encryptEnvValue(input.value);

    const [row] = await tx
      .insert(projectEnvVar)
      .values({
        projectId: input.scope.projectId,
        environmentId: input.scope.environmentId,
        key: input.key,
        value,
        isSecret: input.isSecret ?? true,
        sealed,
      })
      .onConflictDoUpdate({
        target: [projectEnvVar.projectId, projectEnvVar.environmentId, projectEnvVar.key],
        set: {
          value,
          isSecret: input.isSecret ?? true,
          sealed,
        },
      })
      .returning();
    if (!row) throw new Error("projectEnvVar upsert returned no row");
    // Echo the caller's plaintext back for unsealed rows (the UI renders the
    // returned row); sealed rows keep ciphertext so masking holds.
    return sealed ? row : { ...row, value: input.value };
  });
}

/** Drop one key from the (project, environment) bag. No-op when the key
 *  doesn't exist. Keeps idempotent client behaviour. Deleting is the one
 *  form of "undo" a sealed variable supports (no read-back). */
export async function deleteProjectEnvVar(input: { scope: Scope; key: string }): Promise<void> {
  await db
    .delete(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, input.scope.projectId),
        eq(projectEnvVar.environmentId, input.scope.environmentId),
        eq(projectEnvVar.key, input.key),
      ),
    );
}

/**
 * Replace the whole (project, environment) bag in one transaction. The
 * Shared variables tab uses this as its Save action. The editor sends
 * the full desired state; rows not in `next` are dropped, others are
 * upserted. Atomic so the resolver never sees a partially-applied set
 * during a deploy.
 *
 * Sealed rows are DELIBERATELY exempt from this whole dance: they're never
 * deleted by the "rows not in `next`" pruning, and any `next` entry whose
 * key collides with an existing sealed row is dropped rather than applied.
 * The bulk editor round-trips values it read back from the API. A sealed
 * row's plaintext was never sent to it in the first place (masked by the
 * org-scoped handler), so blindly re-inserting `next`'s entry would
 * silently clobber the secret with an empty/stale value. Sealed vars are
 * managed one at a time via `upsertProjectEnvVar` / `deleteProjectEnvVar`.
 */
export async function bulkReplaceProjectEnvVars(
  scope: Scope,
  next: ReadonlyArray<{ key: string; value: string; isSecret?: boolean }>,
): Promise<ProjectEnvVarRow[]> {
  return db.transaction(async (tx) => {
    const sealedRows: ProjectEnvVarRow[] = await tx
      .select()
      .from(projectEnvVar)
      .where(
        and(
          eq(projectEnvVar.projectId, scope.projectId),
          eq(projectEnvVar.environmentId, scope.environmentId),
          eq(projectEnvVar.sealed, true),
        ),
      );
    const sealedKeys = new Set(sealedRows.map((r) => r.key));

    await tx
      .delete(projectEnvVar)
      .where(
        and(
          eq(projectEnvVar.projectId, scope.projectId),
          eq(projectEnvVar.environmentId, scope.environmentId),
          eq(projectEnvVar.sealed, false),
        ),
      );

    const toInsert = next.filter((v) => !sealedKeys.has(v.key));
    let inserted: ProjectEnvVarRow[] = [];
    if (toInsert.length > 0) {
      // Encrypt-at-rest (od-3pp7): ciphertext in the DB, but return the
      // caller's plaintext (the editor re-renders the returned rows).
      const values = await Promise.all(
        toInsert.map(async (v) => ({
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          key: v.key,
          value: await encryptEnvValue(v.value),
          isSecret: v.isSecret ?? true,
          sealed: false,
        })),
      );
      const plaintextByKey = new Map(toInsert.map((v) => [v.key, v.value]));
      const rows = await tx.insert(projectEnvVar).values(values).returning();
      inserted = rows.map((row) => ({
        ...row,
        value: plaintextByKey.get(row.key) ?? row.value,
      }));
    }

    return [...inserted, ...sealedRows].sort((a, b) => a.key.localeCompare(b.key));
  });
}
