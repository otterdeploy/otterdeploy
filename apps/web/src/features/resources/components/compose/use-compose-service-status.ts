/**
 * Per-service status for a compose stack panel — derived from the EXACT same
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
import { useActiveEnvironment } from "@/features/shell/use-active-environment";

import { baseStatus, type StackServiceStatus } from "./panel-parts";

export function useComposeServiceStatus(resource: {
  resourceId: string;
  projectId: string;
  latestDeploymentStatus: Parameters<typeof baseStatus>[0];
}): (name: string) => StackServiceStatus {
  const { data: taskRows } = useLiveQuery(
    (q) =>
      q.from({ d: serviceTasksCollection }).where(({ d }) => eq(d.projectId, resource.projectId)),
    [resource.projectId],
  );
  // `stackId` lives only on the service variant, so we can't filter on it in
  // the typed where-clause — scope by projectId and narrow to this stack's
  // children in JS below.
  const activeEnv = useActiveEnvironment(resource.projectId);
  const { data: projectResources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, resource.projectId), eq(r.environmentId, activeEnv.id ?? "")),
        ),
    [resource.projectId, activeEnv.id],
  );
  const tasksByResourceId = (() => {
    const m = new Map<string, Task[]>();
    for (const row of taskRows) m.set(row.resourceId, row.tasks as Task[]);
    return m;
  })();
  const statusByName = (() => {
    const m = new Map<string, StackServiceStatus>();
    for (const c of projectResources) {
      if (c.type !== "service" || c.stackId !== resource.resourceId) continue;
      m.set(c.name, childServiceStatus(c, tasksByResourceId.get(c.resourceId) ?? []));
    }
    return m;
  })();
  const base = baseStatus(resource.latestDeploymentStatus);
  return (name: string) => statusByName.get(name) ?? base ?? "offline";
}
