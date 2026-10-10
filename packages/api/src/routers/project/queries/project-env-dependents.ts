/**
 * Shared variables reach a service only through its own env rows:
 * `${{project.X}}` / `${{environment.X}}` references, expanded at deploy time
 * from the (project, environment) bag. So changing a shared value changes what
 * those services WOULD run with, and nothing told them: their
 * `serviceResource.envChangedAt` stayed put, and the service read as running
 * its current env while the container still held the old value.
 *
 * Every write to the bag now stamps `envChangedAt` on the services in that
 * environment whose env references a changed key, in the writer's
 * transaction, so env liveness (service views.ts `envLiveness`) reads
 * `pending` until their next roll re-reads the env.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource, serviceEnvVar, serviceResource } from "@otterdeploy/db/schema/project";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { decryptUnsealedEnvRows } from "../../../lib/env-crypto";
import { extractRefs } from "../../../lib/variables/parser";

/** An open transaction (or the pool): reads and the stamp. */
type Writer = Pick<typeof db, "select" | "update">;

interface Scope {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}

/** Does this env value reference one of `keys` in the shared bag? */
function referencesShared(value: string, keys: ReadonlySet<string>): boolean {
  return extractRefs(value).some(
    (ref) =>
      ref.stack === undefined &&
      (ref.resource === "project" || ref.resource === "environment") &&
      keys.has(ref.var),
  );
}

/**
 * Services in `scope` whose base env references a key in `keys`. A service
 * resolves against its own environment (an unstamped resource is main's), and
 * reads rows unscoped or scoped to that environment (overlayServiceEnv).
 * Sealed rows hold ciphertext and are not inspected.
 */
async function sharedVarDependents(
  writer: Writer,
  scope: Scope,
  keys: ReadonlySet<string>,
): Promise<ResourceId[]> {
  if (keys.size === 0) return [];
  const rows = await writer
    .select({
      resourceId: serviceEnvVar.serviceResourceId,
      rowEnvironmentId: serviceEnvVar.environmentId,
      resourceEnvironmentId: resource.environmentId,
      mainEnvironmentId: project.environmentId,
      value: serviceEnvVar.value,
      sealed: serviceEnvVar.sealed,
    })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(resource.projectId, scope.projectId),
        isNull(serviceEnvVar.previewId),
        eq(serviceEnvVar.sealed, false),
      ),
    )
    .$withCache(false);
  const dependents = new Set<ResourceId>();
  for (const row of await decryptUnsealedEnvRows(rows)) {
    const serviceEnvironment = row.resourceEnvironmentId ?? row.mainEnvironmentId;
    if (serviceEnvironment !== scope.environmentId) continue;
    if (row.rowEnvironmentId !== null && row.rowEnvironmentId !== scope.environmentId) continue;
    if (referencesShared(row.value, keys)) dependents.add(row.resourceId);
  }
  return [...dependents];
}

/** Stamp `envChangedAt` on every service the changed shared keys reach. */
export async function markSharedVarDependentsChanged(
  writer: Writer,
  scope: Scope,
  keys: ReadonlySet<string>,
): Promise<ResourceId[]> {
  const dependents = await sharedVarDependents(writer, scope, keys);
  if (dependents.length === 0) return [];
  await writer
    .update(serviceResource)
    // The app clock, like markEnvChanged and envAppliedAt: the two are compared.
    .set({ envChangedAt: new Date() })
    .where(inArray(serviceResource.resourceId, dependents));
  return dependents;
}

/** The keys a whole-bag replace changes: added, removed, or given a new value. */
export function changedSharedKeys(
  before: ReadonlyArray<{ key: string; value: string }>,
  after: ReadonlyArray<{ key: string; value: string }>,
): Set<string> {
  const was = new Map(before.map((r) => [r.key, r.value]));
  const now = new Map(after.map((r) => [r.key, r.value]));
  const changed = new Set<string>();
  for (const [key, value] of now) if (was.get(key) !== value) changed.add(key);
  for (const key of was.keys()) if (!now.has(key)) changed.add(key);
  return changed;
}
