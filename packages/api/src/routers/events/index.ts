import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { matchError } from "better-result";

import type { CollectionEvent, OrgCollectionEvent } from "./contract";

import { orgScopedProcedure } from "../../index";
import {
  type ProjectStreamEvent,
  streamProjectEvents,
  validateProjectEventsStream,
} from "../project/events-stream";
import { subscribeOrgEvents } from "../project/project-event-bus";

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

  // Payload-free write announcements: one resync for exactly the collection
  // named by the event, no per-resource fan-out.
  if (event.kind === "manifest" || event.kind === "previews") {
    return [{ protocol: 1, collection: event.kind, scope: baseScope, op: "resync" }];
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

/**
 * Org-channel bus events, bridged to a bounded async generator. Mirrors
 * streamProjectEvents' queue discipline: a slow reader drops oldest rather
 * than backpressuring Redis, and the client's poll backstops repair the gap.
 */
async function* streamOrgCollectionEvents(
  organizationId: OrganizationId,
): AsyncGenerator<OrgCollectionEvent, void, void> {
  const queue: OrgCollectionEvent[] = [];
  const MAX_QUEUE = 50;
  let resolveNext: (() => void) | null = null;
  let aborted = false;

  const sub = subscribeOrgEvents(organizationId, (event) => {
    if (aborted) return;
    queue.push({
      protocol: 1,
      collection: event.kind,
      scope: { organizationId },
      op: "resync",
    });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  });

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    aborted = true;
    sub.close();
  }
}

export const eventsRouter = {
  orgStream: orgScopedProcedure.events.orgStream.handler(async ({ context, errors }) => {
    // Security rule 3 of the sync design: an actor whose visibility is
    // narrower than the stream key is refused, not filtered. A
    // projectScope:"selected" key would otherwise learn about org-wide
    // activity outside its allow-list.
    if (context.apiKey?.projectScope === "selected") {
      throw errors.FORBIDDEN();
    }
    return streamOrgCollectionEvents(context.activeOrganizationId);
  }),

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
