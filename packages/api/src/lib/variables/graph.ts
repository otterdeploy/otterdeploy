/**
 * Dependency graph traversal for the auto-redeploy fan-out.
 *
 * When a referenced resource's exported variables change, every service that
 * references it (directly or transitively) needs to redeploy with the new
 * values. We rebuild this each time from `service_env_var` rows so there's
 * no separate materialized graph to drift.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import {
  findServiceDependentsByName,
  getServiceRecord,
  getStackRefIdentity,
  type ServiceRecord,
  type StackRefIdentity,
} from "../../routers/service/queries";
import { extractRefs, type RefToken } from "./parser";

/** One node of the walk: everything needed to find who references it. A stack
 *  child is addressable two extra ways (see [[findServiceDependentsByName]]),
 *  so its compose identity travels with it. */
interface GraphNode {
  resourceId: ResourceId;
  resourceName: string;
  stackRef: StackRefIdentity | undefined;
}

/**
 * Returns the set of `serviceResourceId`s that transitively depend on the
 * variables exported by `targetResource`. The target itself is NOT included.
 *
 * Lookup is by `resource.name` because that's what users write in templates;
 * we pass both `targetResourceId` (to avoid self-listing) and
 * `targetResourceName` (to find dependents whose env values mention it). A
 * stack child is additionally reachable by its compose service key, which is
 * the form templates ship with, so that addressing is resolved per node.
 */
export async function findTransitiveDependents(input: {
  projectId: ProjectId;
  targetResourceId: ResourceId;
  targetResourceName: string;
}): Promise<ResourceId[]> {
  const visited = new Set<ResourceId>();
  const result: ResourceId[] = [];
  const queue: GraphNode[] = [
    {
      resourceId: input.targetResourceId,
      resourceName: input.targetResourceName,
      stackRef: await getStackRefIdentity(input.targetResourceId),
    },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const direct = await findServiceDependentsByName({
      projectId: input.projectId,
      targetResourceName: current.resourceName,
      stackRef: current.stackRef,
    });

    for (const depId of direct) {
      if (depId === input.targetResourceId) continue;
      if (visited.has(depId)) continue;
      visited.add(depId);
      result.push(depId);

      const depRecord = await getServiceRecord(input.projectId, depId);
      if (!depRecord) continue;

      if (refsAnythingOtherThan(depRecord, current)) {
        queue.push({
          resourceId: depRecord.service.resourceId,
          resourceName: depRecord.resource.name,
          stackRef: await getStackRefIdentity(depRecord.service.resourceId),
        });
      }
    }
  }

  return result;
}

/**
 * True if the service has any env-var ref to something other than the node we
 * just came from. Used to decide whether to walk further into the graph, so it
 * errs toward walking: a ref whose addressing can't be matched against `from`
 * counts as "other".
 */
function refsAnythingOtherThan(record: ServiceRecord, from: GraphNode): boolean {
  for (const envVar of record.env) {
    for (const ref of extractRefs(envVar.value)) {
      if (!addresses(ref, from)) return true;
    }
  }
  return false;
}

/** Whether one parsed ref points at `node`, across all three addressings. */
function addresses(ref: RefToken, node: GraphNode): boolean {
  if (!ref.stack) return ref.resource === node.resourceName;
  if (!node.stackRef) return false;
  if (ref.resource !== node.stackRef.composeService) return false;
  // Self scope (`stack.`) is only this node when the referrer is its sibling.
  // The caller already restricted the candidate set that way in SQL, so a
  // compose-key match is the whole test here.
  return ref.stack.name === null || ref.stack.name === node.stackRef.stackName;
}
