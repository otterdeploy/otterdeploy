/**
 * The per-service outgoing-ref graph a preview's database-branching walk
 * runs over. Split out of preview-db.ts: that file owns the branch
 * lifecycle, this one owns turning env values into name-keyed ref edges —
 * including the two concerns that make that non-trivial now:
 *
 *  - stack-scoped refs name their target by COMPOSE KEY and must be
 *    translated back to a resource name (buildRefIndex / resolveRefTargetName);
 *  - values are encrypted at rest (od-3pp7), so the scan decrypts unsealed
 *    rows first. Sealed rows are skipped — extractRefs on their ciphertext
 *    found nothing before encryption either.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource, serviceEnvVar, serviceResource } from "@otterdeploy/db/schema/project";
import { and, eq, isNull } from "drizzle-orm";

import type { RefIndex } from "../lib/variables/stack-refs";

import { decryptEnvValue } from "../lib/env-crypto";
import { extractRefs } from "../lib/variables/parser";
import { buildRefIndex, resolveRefTargetName } from "../lib/variables/stack-refs";

/** Each service's outgoing refs, as resource NAMES, keyed by service id. */
function outgoingRefNames(
  rows: ReadonlyArray<{ serviceResourceId: string; value: string }>,
  index: RefIndex<string>,
): Map<string, Set<string>> {
  const byId = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = byId.get(row.serviceResourceId);
    if (!set) {
      set = new Set<string>();
      byId.set(row.serviceResourceId, set);
    }
    for (const ref of extractRefs(row.value)) {
      const name = resolveRefTargetName(ref, row.serviceResourceId, index);
      if (name) set.add(name);
    }
  }
  return byId;
}

/**
 * service resource id -> the resource NAMES its env refs point at, for every
 * base (non-preview) service in the project. `resources` is the caller's
 * already-fetched base resource list, so the name lookup isn't queried twice.
 */
export async function serviceRefGraph(
  projectId: ProjectId,
  resources: ReadonlyArray<{ id: ResourceId; name: string }>,
): Promise<Map<string, Set<string>>> {
  const members = await db
    .select({
      resourceId: serviceResource.resourceId,
      stackId: serviceResource.stackId,
      composeService: serviceResource.composeService,
    })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(and(eq(resource.projectId, projectId), isNull(resource.previewId)));
  const refIndex = buildRefIndex({ resources, members });

  const envRows = await db
    .select({
      serviceResourceId: serviceEnvVar.serviceResourceId,
      value: serviceEnvVar.value,
      sealed: serviceEnvVar.sealed,
    })
    .from(serviceEnvVar)
    .innerJoin(resource, eq(resource.id, serviceEnvVar.serviceResourceId))
    .where(and(eq(resource.projectId, projectId), isNull(serviceEnvVar.previewId)));
  const scannable: Array<{ serviceResourceId: string; value: string }> = [];
  for (const row of envRows) {
    if (row.sealed) continue;
    scannable.push({
      serviceResourceId: row.serviceResourceId,
      value: await decryptEnvValue(row.value),
    });
  }
  return outgoingRefNames(scannable, refIndex);
}
