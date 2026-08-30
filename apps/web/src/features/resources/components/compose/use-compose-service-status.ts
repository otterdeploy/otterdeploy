/**
 * Per-service status for a compose stack, derived from the EXACT same source
 * the graph node reads (the stack's real child service resources + their live
 * tasks), so the node, the member strip and the stack panel can never disagree
 * about what's running.
 *
 * The hook that used to live here is gone: `_shared/use-stack-members` now
 * reads the collections once and hands every surface the members WITH their
 * state. This file keeps the pure join, which that hook (and its test) call.
 */

import {
  childServiceStatus,
  memberBase,
  type Task,
} from "@/features/projects/components/graph/build-live-nodes";

import { type StackServiceStatus } from "./panel-parts";

/** A child service row as this lookup reads it. Structural so the test can pass
 *  a literal without reconstructing the whole resource-collection wire type. */
export interface StackChildRow {
  type: string;
  stackId?: string | null;
  resourceId: string;
  serviceName?: string;
  latestDeploymentStatus: Parameters<typeof childServiceStatus>[0]["latestDeploymentStatus"];
}

/**
 * Resolve a declared compose service (by its RUNTIME name) to its child
 * resource's status, falling back to the stack's own deploy state when the
 * stack has no child for it yet.
 *
 * The join key is `serviceName`. NEVER the child's resource name.
 * `pickResourceName` collision-suffixes that one (stack "it-tools-2" + service
 * "it-tools" → resource "it-tools-2-it-tools"; a namesake → "<stack>-service"),
 * so keying on it matched the declared compose key for essentially no stack.
 * Every member silently fell through to `base`, i.e. this panel rendered the
 * STACK's deploy status N times over while the graph: which already joins on
 * serviceName: showed each child's real state. That is the panel and the node
 * contradicting each other about one deploy, which is exactly what this
 * module's header promises cannot happen.
 *
 * Pure and exported for the test that pins the join key.
 */
export function composeStatusLookup(input: {
  stackResourceId: string;
  resources: readonly StackChildRow[];
  tasksByResourceId: ReadonlyMap<string, Task[]>;
  base: StackServiceStatus | undefined;
}): (serviceName: string) => StackServiceStatus {
  const byServiceName = new Map<string, StackServiceStatus>();
  for (const c of input.resources) {
    if (c.type !== "service" || c.stackId !== input.stackResourceId || !c.serviceName) continue;
    byServiceName.set(
      c.serviceName,
      // A child with no deployment of its own falls back to the stack's state
      // through the SAME rule the graph node uses (memberBase): a member the
      // rollout hasn't reached is queued, not "Pending".
      childServiceStatus(
        c,
        input.tasksByResourceId.get(c.resourceId) ?? [],
        memberBase(input.base),
      ),
    );
  }
  return (serviceName: string) => byServiceName.get(serviceName) ?? input.base ?? "offline";
}
