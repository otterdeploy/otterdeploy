/**
 * Per-service status for a compose stack panel, derived from the EXACT same
 * source the graph node reads (the stack's real child service resources +
 * their live tasks), so the node and this panel can never disagree about
 * what's running. Extracted out of ComposeResourcePanel to keep that
 * component under the line/complexity caps.
 */
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import {
  childServiceStatus,
  type Task,
} from "@/features/projects/components/graph/build-live-nodes";
import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";

import { baseStatus, type StackServiceStatus } from "./panel-parts";

export function useComposeServiceStatus(resource: {
  resourceId: string;
  projectId: string;
  latestDeploymentStatus: Parameters<typeof baseStatus>[0];
}): (serviceName: string) => StackServiceStatus {
  const { data: taskRows } = useLiveQuery(
    (q) =>
      q.from({ d: serviceTasksCollection }).where(({ d }) => eq(d.projectId, resource.projectId)),
    [resource.projectId],
  );
  // `stackId` lives only on the service variant, so we can't filter on it in
  // the typed where-clause: scope by projectId and narrow to this stack's
  // children in JS below.
  const activeEnv = useActiveEnvironment(resource.projectId);
  const { data: projectResources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, resource.projectId), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [resource.projectId, activeEnv.id, activeEnv.isMain],
  );
  const tasksByResourceId = (() => {
    const m = new Map<string, Task[]>();
    for (const row of taskRows) m.set(row.resourceId, row.tasks);
    return m;
  })();
  return composeStatusLookup({
    stackResourceId: resource.resourceId,
    resources: projectResources,
    tasksByResourceId,
    base: baseStatus(resource.latestDeploymentStatus),
  });
}

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
      childServiceStatus(c, input.tasksByResourceId.get(c.resourceId) ?? []),
    );
  }
  return (serviceName: string) => byServiceName.get(serviceName) ?? input.base ?? "offline";
}
