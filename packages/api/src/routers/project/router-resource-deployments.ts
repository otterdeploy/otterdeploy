import { withEventMeta } from "@orpc/server";
import { matchError } from "better-result";

import { orgScopedProcedure } from "../../index";
import { streamDeploymentLogs } from "../deployment/log-stream";
import { listResourceDeployments, listTasksForDeployment, tailDeploymentLogs } from "./handlers";

export const deploymentsResourceRouter = {
  list: orgScopedProcedure.project.resource.deployments.list.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await listResourceDeployments({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value.map((d) => ({
        ...d,
        completedAt: d.completedAt ? d.completedAt.toISOString() : null,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }));
    },
  ),

  tasks: orgScopedProcedure.project.resource.deployments.tasks.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
        deploymentId: input.deploymentId,
      });
      const result = await listTasksForDeployment({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
        deploymentId: input.deploymentId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  logs: {
    tail: orgScopedProcedure.project.resource.deployments.logs.tail.handler(
      ({ input, context }) => {
        context.log.set({
          target: {
            type: "resource",
            id: input.resourceId,
            projectId: input.projectId,
          },
          deploymentId: input.deploymentId,
        });
        return tailDeploymentLogs({
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          deploymentId: input.deploymentId,
          tail: input.tail,
        });
      },
    ),
  },

  // Build-pipeline logs (builder → Redis + deployment_log table). Each
  // scrollback line carries its DB seq as the event-iterator id so the
  // client retry plugin can resume via `lastEventId` instead of replaying
  // the whole log on reconnect. Live lines (seq null) ship without an id.
  buildLogs: {
    stream: orgScopedProcedure.project.resource.deployments.buildLogs.stream.handler(
      async function* ({ input, context, lastEventId }) {
        context.log.set({ deploymentId: input.deploymentId });
        const generator = streamDeploymentLogs({
          deploymentId: input.deploymentId,
          organizationId: context.activeOrganizationId,
          afterSeq: lastEventId != null ? Number(lastEventId) : null,
        });
        for await (const line of generator) {
          yield line.seq != null ? withEventMeta(line, { id: String(line.seq) }) : line;
        }
      },
    ),
  },
};
