/**
 * Reading and writing what each environment last applied (the
 * `environment.applied_manifest*` columns). The rules that use it are pure
 * and live in ./manifest-environment-baseline.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment } from "@otterdeploy/db/schema/project";
import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";
import { and, eq, ne } from "drizzle-orm";

import type { EnvironmentApplied } from "./manifest-environment-baseline";

import { manifestSchema, type Manifest } from "../../stack/manifest";

/** Safe-parsed, never asserted: a value an older schema wrote reads as "not
 *  applied", which makes nothing deletable rather than failing every diff. */
function parsed(raw: unknown): Manifest | null {
  const result = manifestSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** What `environmentId` last applied; both halves null when it never has. */
export async function loadEnvironmentApplied(
  environmentId: EnvironmentId,
): Promise<EnvironmentApplied> {
  const [row] = await db
    .select({
      document: environment.appliedManifest,
      resolved: environment.appliedManifestResolved,
    })
    .from(environment)
    .where(eq(environment.id, environmentId))
    .limit(1)
    // The diff's notion of "already applied": never from the query cache.
    .$withCache(false);
  return { document: parsed(row?.document), resolved: parsed(row?.resolved) };
}

/** What every OTHER environment of the project last applied, each resolved
 *  for itself. Environments that never applied are left out. */
export async function loadAppliedElsewhere(
  projectId: ProjectId,
  environmentId: EnvironmentId,
): Promise<Manifest[]> {
  const rows = await db
    .select({ resolved: environment.appliedManifestResolved })
    .from(environment)
    .where(and(eq(environment.projectId, projectId), ne(environment.id, environmentId)))
    .$withCache(false);
  return rows.flatMap((row) => parsed(row.resolved) ?? []);
}

export async function recordEnvironmentApplied(
  environmentId: EnvironmentId,
  applied: { document: Manifest; resolved: Manifest },
): Promise<void> {
  await db
    .update(environment)
    .set({ appliedManifest: applied.document, appliedManifestResolved: applied.resolved })
    .where(eq(environment.id, environmentId));
}

/** `doc` without `name` in `collection`, or the same object when it has none. */
function without(
  doc: JsonObject | null,
  collection: "services" | "databases" | "composes",
  name: string,
): JsonObject | null {
  const coll = doc?.[collection];
  if (!doc || !isJsonObject(coll) || !(name in coll)) return doc;
  const rest = { ...coll };
  delete rest[name];
  return { ...doc, [collection]: rest };
}

/**
 * Forget a directly deleted resource in every environment's record, as the
 * project's legacy snapshot already does. Left in, an environment that still
 * runs a resource of that name would read it as one the manifest removed.
 */
export async function forgetAppliedEverywhere(
  projectId: ProjectId,
  collection: "services" | "databases" | "composes",
  name: string,
): Promise<void> {
  const rows = await db
    .select({
      id: environment.id,
      document: environment.appliedManifest,
      resolved: environment.appliedManifestResolved,
    })
    .from(environment)
    .where(eq(environment.projectId, projectId));
  for (const row of rows) {
    const document = without(row.document, collection, name);
    const resolved = without(row.resolved, collection, name);
    if (document === row.document && resolved === row.resolved) continue;
    await db
      .update(environment)
      .set({ appliedManifest: document, appliedManifestResolved: resolved })
      .where(eq(environment.id, row.id));
  }
}
