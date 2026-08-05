import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { matchError } from "better-result";

import type { CollectionEvent } from "./contract";

import { orgScopedProcedure } from "../../index";
import {
  type ProjectStreamEvent,
  streamProjectEvents,
  validateProjectEventsStream,
} from "../project/events-stream";

interface CollectionEventScope {
  organizationId: OrganizationId;
  projectId: ProjectId;
}

export function toCollectionEvents(
  event: ProjectStreamEvent,
  scope: CollectionEventScope,
): CollectionEvent[] {
  const baseScope = {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
  };

  if (event.kind === "route") {
    if (event.action === "removed") {
      return [
        {
          protocol: 1,
          collection: "proxy-routes",
          scope: {
            ...baseScope,
            ...(event.resourceId ? { resourceId: event.resourceId } : {}),
          },
          op: "delete",
          keys: [event.routeId],
        },
      ];
    }

    return [
      {
        protocol: 1,
        collection: "proxy-routes",
        scope: {
          ...baseScope,
          ...(event.route.resourceId ? { resourceId: event.route.resourceId } : {}),
        },
        op: "upsert",
        rows: [event.route],
      },
    ];
  }

  const eventScope = { ...baseScope, resourceId: event.resourceId };
  const events: CollectionEvent[] = [
    { protocol: 1, collection: "resources", scope: eventScope, op: "resync" },
    { protocol: 1, collection: "deployments", scope: eventScope, op: "resync" },
    { protocol: 1, collection: "deployment-tasks", scope: eventScope, op: "resync" },
    { protocol: 1, collection: "service-tasks", scope: eventScope, op: "resync" },
  ];

  if (event.kind === "resource" && (event.action === "created" || event.action === "removed")) {
    events.push({
      protocol: 1,
      collection: "dependencies",
      scope: eventScope,
      op: "resync",
    });
  }

  return events;
}

async function* streamCollectionEvents(input: {
  organizationId: OrganizationId;
  projectId: ProjectId;
}): AsyncGenerator<CollectionEvent, void, void> {
  for await (const event of streamProjectEvents(input)) {
    for (const collectionEvent of toCollectionEvents(event, input)) {
      yield collectionEvent;
    }
  }
}

export const eventsRouter = {
  stream: orgScopedProcedure.events.stream.handler(async ({ input, context, errors }) => {
    const scope = {
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
    };
    context.log.set({ target: { type: "project", id: input.projectId } });

    const preflight = await validateProjectEventsStream(scope);
    if (preflight.isErr()) {
      throw matchError(preflight.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
      });
    }

    return streamCollectionEvents(scope);
  }),
};
