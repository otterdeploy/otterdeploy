/**
 * Subscribe once to the multiplexed collection event stream for a project.
 *
 * Pattern (per https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation):
 *   1. Query Collections own the data.
 *   2. Transport is the root oRPC event iterator (`orpc.events.stream`).
 *      Cookies ride along for auth, and
 *      `context.retry` opts the call into the client retry plugin's
 *      auto-reconnect — so this matches every other live stream in the
 *      app instead of being the one bespoke EventSource holdout.
 *   3. `upsert` and `delete` apply authoritative rows directly. `resync`
 *      asks the named collection to run its own queryFn again.
 */

import { useEffect } from "react";

import { type ProjectId } from "@otterdeploy/shared/id";

import { dependenciesCollection } from "@/features/projects/data/dependencies";
import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import {
  deploymentTasksCollection,
  deploymentsCollection,
} from "@/features/resources/data/deployments";
import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { orpc } from "@/shared/server/orpc";

export function useProjectEvents(projectId?: ProjectId | null): void {
  useEffect(() => {
    if (!projectId) return;

    const ctrl = new AbortController();

    void (async () => {
      try {
        const stream = await orpc.events.stream.call(
          { projectId },
          { signal: ctrl.signal, context: { retry: Number.POSITIVE_INFINITY } },
        );
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;

          if (event.op === "upsert") {
            proxyRoutesCollection.utils.writeUpsert(event.rows);
            continue;
          }

          if (event.op === "delete") {
            proxyRoutesCollection.utils.writeDelete(event.keys);
            continue;
          }

          switch (event.collection) {
            case "resources":
              void resourceCollection.utils.refetch();
              break;
            case "deployments":
              void deploymentsCollection.utils.refetch();
              break;
            case "deployment-tasks":
              void deploymentTasksCollection.utils.refetch();
              break;
            case "service-tasks":
              void serviceTasksCollection.utils.refetch();
              break;
            case "dependencies":
              void dependenciesCollection.utils.refetch();
              break;
          }
        }
      } catch (err) {
        // The retry plugin reconnects on transient errors; reaching here
        // means the stream ended terminally (or the component unmounted).
        if (ctrl.signal.aborted) return;
        // eslint-disable-next-line no-console
        console.warn("[project-events] stream ended", err);
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [projectId]);
}
