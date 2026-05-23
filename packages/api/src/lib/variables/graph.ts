/**
 * Dependency graph traversal for the auto-redeploy fan-out.
 *
 * When a referenced resource's exported variables change, every service that
 * references it (directly or transitively) needs to redeploy with the new
 * values. We rebuild this each time from `service_env_var` rows so there's
 * no separate materialized graph to drift.
 */

import {
  findServiceDependentsByName,
  getServiceRecord,
  type ServiceRecord,
} from "../../routers/service/queries";
import { extractRefs } from "./parser";

/**
 * Returns the set of `serviceResourceId`s that transitively depend on the
 * variables exported by `targetResource`. The target itself is NOT included.
 *
 * Lookup is by `resource.name` because that's what users write in templates;
 * we pass both `targetResourceId` (to avoid self-listing) and
 * `targetResourceName` (to find dependents whose env values mention it).
 */
export async function findTransitiveDependents(input: {
  projectId: string;
  targetResourceId: string;
  targetResourceName: string;
}): Promise<string[]> {
  const visited = new Set<string>();
  const result: string[] = [];
  const queue: Array<{ resourceId: string; resourceName: string }> = [
    {
      resourceId: input.targetResourceId,
      resourceName: input.targetResourceName,
    },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const direct = await findServiceDependentsByName({
      projectId: input.projectId,
      targetResourceName: current.resourceName,
    });

    for (const depId of direct) {
      if (depId === input.targetResourceId) continue;
      if (visited.has(depId)) continue;
      visited.add(depId);
      result.push(depId);

      const depRecord = await getServiceRecord(input.projectId, depId);
      if (!depRecord) continue;

      if (refsAnyResourceOtherThan(depRecord, current.resourceName)) {
        queue.push({
          resourceId: depRecord.service.resourceId,
          resourceName: depRecord.resource.name,
        });
      }
    }
  }

  return result;
}

/**
 * True if the service has any env-var ref to a resource other than the one
 * we just came from. Used to decide whether to walk further into the graph.
 */
function refsAnyResourceOtherThan(
  record: ServiceRecord,
  excludeName: string,
): boolean {
  for (const envVar of record.env) {
    for (const ref of extractRefs(envVar.value)) {
      if (ref.resource !== excludeName) return true;
    }
  }
  return false;
}
