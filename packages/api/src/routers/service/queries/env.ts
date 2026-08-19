import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceEnvVar } from "@otterdeploy/db/schema/project";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createError } from "evlog";

import type { ResourceRow, ServiceEnvVarRow } from ".";

import {
  decryptEnvValue,
  decryptUnsealedEnvRows,
  encryptEnvValue,
} from "../../../lib/env-crypto";
// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------

/** BASE rows only: preview overrides never surface in base env editors,
 *  views, refs or manifest state. The resolver overlays preview rows itself
 *  via listPreviewServiceEnvVars. */
export async function listServiceEnvVars(
  serviceResourceId: ResourceId,
): Promise<ServiceEnvVarRow[]> {
  const rows = await db
    .select()
    .from(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, serviceResourceId),
        isNull(serviceEnvVar.previewId),
      ),
    )
    // Bypass the global query cache: an edit that just landed must be visible
    // on the very next read (the resource list polls every 5s), not up to 60s
    // later when the cache TTL expires or a flaky invalidation propagates.
    .$withCache(false);
  // Values are encrypted at rest (od-3pp7); consumers see plaintext, sealed
  // rows keep their ciphertext (write-only, only the resolver decrypts them).
  return decryptUnsealedEnvRows(rows);
}

/** Base env rows for a SET of service resources. One query instead of N
 *  `listServiceEnvVars` calls (the project-resources list fired one per
 *  service). Returns a map keyed by serviceResourceId; services with no base
 *  env vars are absent (the caller defaults them to an empty list). */
export async function listServiceEnvVarsForResources(
  serviceResourceIds: ReadonlyArray<ResourceId>,
): Promise<Map<ResourceId, ServiceEnvVarRow[]>> {
  const result = new Map<ResourceId, ServiceEnvVarRow[]>();
  if (serviceResourceIds.length === 0) return result;
  const rows = await db
    .select()
    .from(serviceEnvVar)
    .where(
      and(
        inArray(serviceEnvVar.serviceResourceId, [...serviceResourceIds]),
        isNull(serviceEnvVar.previewId),
      ),
    )
    // Fresh read. This feeds the resource list's `extraEnv`, which the panel's
    // Variables tab renders; a stale cache hit hides a just-saved var until the
    // 60s TTL lapses (the "I saved it but it's not in the UI" bug).
    .$withCache(false);
  for (const row of await decryptUnsealedEnvRows(rows)) {
    const list = result.get(row.serviceResourceId);
    if (list) list.push(row);
    else result.set(row.serviceResourceId, [row]);
  }
  return result;
}

/** A preview's override rows for one service. */
/**
 * Sealing is sticky and one-way, mirroring `upsertProjectEnvVar`: if the
 * existing base row (or this call) marks the key sealed, the FINAL row is
 * sealed: a caller can never flip it back to unsealed by omitting
 * `sealed: true` on a later write. `value` is encrypted with the
 * "env-vars" domain key whenever the final state is sealed, whether or not
 * THIS call's input already knew that.
 */
export async function upsertServiceEnvVar(input: {
  serviceResourceId: ResourceId;
  key: string;
  value: string;
  isSecret?: boolean;
  sealed?: boolean;
}): Promise<ServiceEnvVarRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ sealed: serviceEnvVar.sealed })
      .from(serviceEnvVar)
      .where(
        and(
          eq(serviceEnvVar.serviceResourceId, input.serviceResourceId),
          eq(serviceEnvVar.key, input.key),
          isNull(serviceEnvVar.previewId),
        ),
      )
      .limit(1);

    const sealed = Boolean(existing?.sealed) || Boolean(input.sealed);
    // Encrypt-at-rest for every row (od-3pp7), not just sealed ones. The
    // sealed flag now only governs READ behavior (write-only masking).
    const value = await encryptEnvValue(input.value);

    const [row] = await tx
      .insert(serviceEnvVar)
      .values({
        serviceResourceId: input.serviceResourceId,
        key: input.key,
        value,
        isSecret: input.isSecret ?? false,
        sealed,
      })
      .onConflictDoUpdate({
        target: [serviceEnvVar.serviceResourceId, serviceEnvVar.key],
        targetWhere: sql`preview_id is null`,
        set: {
          value,
          sealed,
          ...(input.isSecret === undefined ? {} : { isSecret: input.isSecret }),
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw createError({
        message: "Failed to upsert env var",
        status: 500,
        why: "Database upsert returned no row",
      });
    }
    // Echo the caller's plaintext back (the UI renders the returned row);
    // sealed rows keep ciphertext so mapEnvVar's masking contract holds.
    return sealed ? row : { ...row, value: input.value };
  });
}

export async function deleteServiceEnvVar(input: {
  serviceResourceId: ResourceId;
  key: string;
}): Promise<boolean> {
  const result = await db
    .delete(serviceEnvVar)
    .where(
      and(
        eq(serviceEnvVar.serviceResourceId, input.serviceResourceId),
        eq(serviceEnvVar.key, input.key),
        isNull(serviceEnvVar.previewId),
      ),
    )
    .returning({ id: serviceEnvVar.id });
  return result.length > 0;
}

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
): Promise<ServiceEnvVarRow[]> {
  return db.transaction(async (tx) => {
    const sealedRows: ServiceEnvVarRow[] = await tx
      .select()
      .from(serviceEnvVar)
      .where(
        and(
          eq(serviceEnvVar.serviceResourceId, serviceResourceId),
          isNull(serviceEnvVar.previewId),
          eq(serviceEnvVar.sealed, true),
        ),
      );
    const sealedKeys = new Set(sealedRows.map((r) => r.key));

    // Base, unsealed rows only: a bulk edit of the base env must never wipe
    // a PR preview's overrides, and never touches a sealed row.
    await tx
      .delete(serviceEnvVar)
      .where(
        and(
          eq(serviceEnvVar.serviceResourceId, serviceResourceId),
          isNull(serviceEnvVar.previewId),
          eq(serviceEnvVar.sealed, false),
        ),
      );

    const toInsert = vars.filter((v) => !sealedKeys.has(v.key));
    let inserted: ServiceEnvVarRow[] = [];
    if (toInsert.length > 0) {
      // Encrypt-at-rest (od-3pp7): ciphertext in the DB, but return the
      // caller's plaintext (the editor re-renders the returned rows).
      const values = await Promise.all(
        toInsert.map(async (v) => ({
          serviceResourceId,
          key: v.key,
          value: await encryptEnvValue(v.value),
          isSecret: v.isSecret ?? false,
          sealed: false,
        })),
      );
      const plaintextByKey = new Map(toInsert.map((v) => [v.key, v.value]));
      const rows = await tx.insert(serviceEnvVar).values(values).returning();
      inserted = rows.map((row) => ({
        ...row,
        value: plaintextByKey.get(row.key) ?? row.value,
      }));
    }

    return [...inserted, ...sealedRows].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
  });
}

/**
 * Preview-aware resource lookup for the variable resolver: a preview-scoped
 * row (an opt-in DB branch, `previewId = <preview>`) wins over the base row
 * (`previewId IS NULL`), which every non-preview resource is. Ordering NULLs
 * last puts the preview-scoped match first, so LIMIT 1 returns the branch when
 * present and the base otherwise. With no preview scope this always resolves
 * to the base row: identical to `getResourceByProjectAndName`.
 */
export async function resolveResourceForPreview(
  projectId: ProjectId,
  previewId: PreviewId | null,
  name: string,
): Promise<ResourceRow | undefined> {
  if (!previewId) {
    const [row] = await db
      .select()
      .from(resource)
      .where(
        and(
          eq(resource.projectId, projectId),
          eq(resource.name, name),
          isNull(resource.previewId),
        ),
      )
      .limit(1);
    return row;
  }
  const [row] = await db
    .select()
    .from(resource)
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(resource.name, name),
        or(eq(resource.previewId, previewId), isNull(resource.previewId)),
      ),
    )
    .orderBy(sql`${resource.previewId} nulls last`)
    .limit(1);
  return row;
}

/**
 * Find services in `projectId` whose env-var values literally reference
 * `${{<targetResourceName>.…}}`. Returns service resource IDs.
 *
 * Best-effort in-process scan (the resolver re-parses each candidate to
 * confirm and to skip escaped tokens `\${{…}}`). This used to be a SQL
 * `LIKE`, but values are encrypted at rest now (od-3pp7), so the scan
 * decrypts app-side. Sealed rows are skipped — the old ciphertext `LIKE`
 * could never match them either, so this preserves behavior exactly.
 */
export async function findServiceDependentsByName(input: {
  projectId: ProjectId;
  targetResourceName: string;
}): Promise<ResourceId[]> {
  const rows = await db
    .select({
      serviceResourceId: serviceEnvVar.serviceResourceId,
      value: serviceEnvVar.value,
      sealed: serviceEnvVar.sealed,
    })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(
      and(
        eq(resource.projectId, input.projectId),
        isNull(serviceEnvVar.previewId),
      ),
    );

  const needle = `\${{${input.targetResourceName}.`;
  // Dedupe: a service can reference the target via multiple env vars.
  const dependents = new Set<ResourceId>();
  for (const row of rows) {
    if (row.sealed || dependents.has(row.serviceResourceId)) continue;
    if ((await decryptEnvValue(row.value)).includes(needle)) {
      dependents.add(row.serviceResourceId);
    }
  }
  return Array.from(dependents);
}
