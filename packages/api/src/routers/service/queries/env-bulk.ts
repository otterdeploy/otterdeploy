/**
 * The whole-map replace of a service's base env (the bulk editor and the
 * manifest reconcile). Split out of env.ts (line cap); re-exported there.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceEnvVar } from "@otterdeploy/db/schema/project";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import type { EnvVarSource, ServiceEnvVarRow } from ".";

import { decryptUnsealedEnvRows, encryptEnvValue } from "../../../lib/env-crypto";
import { envBagChanged, lockServiceForEnvWrite, markEnvChanged } from "./env-liveness";

/**
 * Sealed rows are DELIBERATELY exempt from this whole dance, mirroring
 * `bulkReplaceProjectEnvVars`: they're never deleted by the "base rows"
 * pruning, and any `vars` entry whose key collides with an existing sealed
 * row is dropped rather than applied. The bulk editor round-trips values it
 * read back from the API. A sealed row's plaintext was never sent to it in
 * the first place (masked by `mapEnvVar`), so blindly re-inserting that
 * entry would silently clobber the secret with an empty/stale value. Sealed
 * vars are managed one at a time via `upsertServiceEnvVar` / `deleteServiceEnvVar`.
 */
export async function bulkReplaceServiceEnvVars(
  serviceResourceId: ResourceId,
  vars: Array<{ key: string; value: string; isSecret?: boolean }>,
  source: EnvVarSource = "unknown",
): Promise<ServiceEnvVarRow[]> {
  return db.transaction(async (tx) => {
    // One whole-map replace of a service at a time. Under READ COMMITTED two
    // replaces each ran their DELETE before the other's INSERT committed, so
    // both inserted the full map and the second hit service_env_var_unique: a
    // 500 for an ordinary double save. The row lock queues the second replace
    // behind the first; it then reads, prunes and writes what the first left.
    await lockServiceForEnvWrite(tx, serviceResourceId);
    const baseRows: ServiceEnvVarRow[] = await tx
      .select()
      .from(serviceEnvVar)
      .where(
        and(
          eq(serviceEnvVar.serviceResourceId, serviceResourceId),
          isNull(serviceEnvVar.previewId),
        ),
      );
    const sealedRows = baseRows.filter((r) => r.sealed);
    const sealedKeys = new Set(sealedRows.map((r) => r.key));

    // A MANIFEST reconcile owns only what the manifest wrote. Rows a human
    // set with `env set` are not the file's to prune, and deleting them is
    // how imperative secrets disappeared on deploy. A live edit still
    // replaces wholesale — the editor sends the whole bag, so omission there
    // really is a delete.
    const incoming = new Set(vars.map((v) => v.key));
    const kept =
      source === "manifest"
        ? baseRows.filter((r) => !r.sealed && r.source !== "manifest" && !incoming.has(r.key))
        : [];
    const keptKeys = new Set(kept.map((r) => r.key));

    // Base, unsealed rows only: a bulk edit of the base env must never wipe a
    // PR preview's overrides, and never touches a sealed row.
    await tx
      .delete(serviceEnvVar)
      .where(
        and(
          eq(serviceEnvVar.serviceResourceId, serviceResourceId),
          isNull(serviceEnvVar.previewId),
          eq(serviceEnvVar.sealed, false),
          keptKeys.size > 0 ? notInArray(serviceEnvVar.key, [...keptKeys]) : undefined,
        ),
      );

    const toInsert = vars.filter((v) => !sealedKeys.has(v.key));
    let inserted: ServiceEnvVarRow[] = [];
    if (toInsert.length > 0) {
      // Encrypt-at-rest: ciphertext in the DB, but return the
      // caller's plaintext (the editor re-renders the returned rows).
      const values = await Promise.all(
        toInsert.map(async (v) => ({
          serviceResourceId,
          key: v.key,
          value: await encryptEnvValue(v.value),
          isSecret: v.isSecret ?? false,
          sealed: false,
          source,
        })),
      );
      const plaintextByKey = new Map(toInsert.map((v) => [v.key, v.value]));
      // An upsert, not a plain insert: a single-key `env set` takes no lock,
      // so it can still land a key between this DELETE and this INSERT. The
      // replace is the later write there, so its value wins.
      const rows = await tx
        .insert(serviceEnvVar)
        .values(values)
        .onConflictDoUpdate({
          target: [serviceEnvVar.serviceResourceId, serviceEnvVar.key],
          targetWhere: sql`preview_id is null`,
          set: {
            value: sql`excluded.value`,
            isSecret: sql`excluded.is_secret`,
            source,
            updatedAt: new Date(),
          },
          // A key sealed in between stays sealed and keeps its secret.
          setWhere: sql`${serviceEnvVar.sealed} = false`,
        })
        .returning();
      inserted = rows.map((row) => ({
        ...row,
        value: plaintextByKey.get(row.key) ?? row.value,
      }));
    }

    // Only a real change makes the running env stale: the editor and the
    // manifest reconcile both send the whole bag, usually unchanged.
    const before = await decryptUnsealedEnvRows(baseRows.filter((r) => !r.sealed));
    const keptPlain = before.filter((r) => keptKeys.has(r.key));
    if (envBagChanged(before, [...toInsert, ...keptPlain])) {
      await markEnvChanged(tx, serviceResourceId);
    }

    return [...inserted, ...sealedRows, ...kept].sort((a, b) => a.key.localeCompare(b.key));
  });
}
