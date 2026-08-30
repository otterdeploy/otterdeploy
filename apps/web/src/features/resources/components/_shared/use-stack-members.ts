/**
 * A stack and its members, with each member's {@link ResourceState}, for the
 * member strip. Read from the SAME collections the graph node reads (the
 * project's resource rows + their live tasks), through the same join
 * (`serviceName`, never the collision-suffixed child name) and the same status
 * rule (`composeStatusLookup`), so the strip, the stack header and the canvas
 * cannot disagree about one deploy.
 *
 * Used from three places: the stack panel (its own members), a member service
 * panel (its siblings, resolved from `stackId`), and nothing else. A standalone
 * resource passes no stack id and gets null.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { ResourceState } from "@/features/resources/lib/resource-state";

import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { memberState, stackState } from "@/features/resources/lib/resource-state";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";

import { baseStatus } from "../compose/panel-parts";
import { composeStatusLookup } from "../compose/use-compose-service-status";

export interface StackMember {
  /** Display name: the compose key. */
  name: string;
  /** Runtime name: the join key to the child resource. */
  serviceName: string;
  /** The child's real resource id, once the stack has deployed. */
  resourceId: string | null;
  hasBuild: boolean;
  image: string | null;
  state: ResourceState;
}

export interface StackView {
  resourceId: string;
  name: string;
  members: StackMember[];
  state: ResourceState;
}

export function useStackMembers(input: {
  projectId: string;
  stackResourceId: string | null | undefined;
}): StackView | null {
  const { projectId, stackResourceId } = input;
  const activeEnv = useActiveEnvironment(projectId);
  const { data: rows } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, projectId), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [projectId, activeEnv.id, activeEnv.isMain],
  );
  const { data: taskRows } = useLiveQuery(
    (q) => q.from({ t: serviceTasksCollection }).where(({ t }) => eq(t.projectId, projectId)),
    [projectId],
  );
  if (!stackResourceId) return null;
  const stack = rows.find((r) => r.type === "compose" && r.resourceId === stackResourceId);
  if (!stack || stack.type !== "compose") return null;

  const tasksByResourceId = new Map(taskRows.map((row) => [row.resourceId, row.tasks] as const));
  const statusOf = composeStatusLookup({
    stackResourceId,
    resources: rows,
    tasksByResourceId,
    base: baseStatus(stack.latestDeploymentStatus),
  });
  const children = rows.flatMap((r) =>
    r.type === "service" && r.stackId === stackResourceId ? [r] : [],
  );
  const childByServiceName = new Map(children.map((c) => [c.serviceName, c] as const));

  // Every service the file declares, overlaid with its child where one exists.
  // A git stack has no declared summary until its first build; fall back to
  // whatever children exist so the strip is never empty for a live stack.
  const declared =
    stack.services.length > 0
      ? stack.services.map((s) => ({
          name: s.name,
          serviceName: s.serviceName,
          image: s.image,
          hasBuild: s.hasBuild,
        }))
      : children.map((c) => ({
          name: c.name,
          serviceName: c.serviceName,
          image: c.image,
          hasBuild: c.source === "git",
        }));

  const members: StackMember[] = declared.map((s) => {
    const child = childByServiceName.get(s.serviceName);
    return {
      name: s.name,
      serviceName: s.serviceName,
      resourceId: child?.resourceId ?? null,
      hasBuild: s.hasBuild,
      image: s.image,
      state: memberState(statusOf(s.serviceName), {
        hasBuild: s.hasBuild,
        tasks: child ? (tasksByResourceId.get(child.resourceId) ?? []) : [],
      }),
    };
  });

  return {
    resourceId: stack.resourceId,
    name: stack.name,
    members,
    state: stackState(members),
  };
}
