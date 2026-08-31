import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { OrgBusEvent } from "@otterdeploy/shared/org-events";

import { ID_PREFIX, hasPrefix } from "@otterdeploy/shared/id";
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

async function* streamCollectionEvents(
  input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
  },
  signal?: AbortSignal,
): AsyncGenerator<CollectionEvent, void, void> {
  for await (const event of streamProjectEvents(input, signal)) {
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
/**
 * Bus event → wire event.
 *
 * The bus and the stream carry the same two shapes, so this is a translation
 * and not a decision: a payload-free kind becomes a `resync`, a row-carrying
 * one keeps its rows. Dates cross the bus as ISO strings (it is JSON) and the
 * contract's `z.coerce.date()` turns them back on the way out.
 */
function toOrgCollectionEvent(
  organizationId: OrganizationId,
  event: OrgBusEvent,
): OrgCollectionEvent {
  const scope = { organizationId };
  if (!("op" in event)) {
    return { protocol: 1, collection: event.kind, scope, op: "resync" };
  }
  if (event.op === "delete") {
    return {
      protocol: 1,
      collection: "data-connections",
      scope,
      op: "delete",
      keys: event.keys.filter((key) => hasPrefix(key, ID_PREFIX.dataConnection)),
    };
  }
  return {
    protocol: 1,
    collection: "data-connections",
    scope,
    op: "upsert",
    rows: event.rows.flatMap((row) =>
      // A row whose id does not carry the expected prefix is a malformed
      // publish, not a row to render. Dropping it keeps a bad producer from
      // poisoning every subscriber's collection.
      hasPrefix(row.id, ID_PREFIX.dataConnection)
        ? [
            {
              ...row,
              id: row.id,
              createdAt: new Date(row.createdAt),
              lastConnectedAt: row.lastConnectedAt === null ? null : new Date(row.lastConnectedAt),
            },
          ]
        : [],
    ),
  };
}

async function* streamOrgCollectionEvents(
  organizationId: OrganizationId,
  signal?: AbortSignal,
): AsyncGenerator<OrgCollectionEvent, void, void> {
  const queue: OrgCollectionEvent[] = [];
  const MAX_QUEUE = 50;
  let resolveNext: (() => void) | null = null;
  let aborted = false;

  const wake = () => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  // The loop below parks in an `await` between events, and `generator.return()`
  // (what the transport calls on client disconnect) cannot interrupt an
  // await: it only takes effect at the next `yield`, which in a quiet org
  // never comes. Every closed orgStream therefore parked its dedicated Redis
  // subscriber connection forever (~145 leaked clients over three days of
  // prod, od-664). The abort signal is the one notification that fires on
  // disconnect, so it must wake the parked loop; the `finally` then closes
  // the subscriber.
  const onAbort = () => {
    aborted = true;
    wake();
  };
  if (signal?.aborted) aborted = true;
  signal?.addEventListener("abort", onAbort);

  const sub = subscribeOrgEvents(organizationId, (event) => {
    if (aborted) return;
    queue.push(toOrgCollectionEvent(organizationId, event));
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    wake();
  });

  try {
    while (!aborted) {
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
    signal?.removeEventListener("abort", onAbort);
    sub.close();
  }
}

export const eventsRouter = {
  orgStream: orgScopedProcedure.events.orgStream.handler(async ({ context, errors, signal }) => {
    // Security rule 3 of the sync design: an actor whose visibility is
    // narrower than the stream key is refused, not filtered. A
    // projectScope:"selected" key would otherwise learn about org-wide
    // activity outside its allow-list.
    if (context.apiKey?.projectScope === "selected") {
      throw errors.FORBIDDEN();
    }
    return streamOrgCollectionEvents(context.activeOrganizationId, signal);
  }),

  stream: orgScopedProcedure.events.stream.handler(async ({ input, context, errors, signal }) => {
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

    return streamCollectionEvents(scope, signal);
  }),
};
