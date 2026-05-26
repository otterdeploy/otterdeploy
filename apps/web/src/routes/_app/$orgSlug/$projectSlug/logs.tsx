import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useMemo } from "react";
import * as z from "zod";

import { LogsPage } from "@/features/logs/components/logs-page";
import { createResourceCollection } from "@/features/projects/data/resource";

const zLogsSearch = z.object({
  service: z.string().optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/logs")({
  staticData: { crumb: "Logs" },
  validateSearch: zLogsSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const { service } = Route.useSearch();

  // Per-project resources, same source the graph reads from. Only services
  // populate the filter — database log streams land in a separate surface
  // (or on the resource detail panel's Logs tab) so they don't double up.
  const resourceCollection = useMemo(
    () => createResourceCollection(project.id),
    [project.id],
  );
  const { data: resources = [] } = useLiveQuery(
    () => resourceCollection,
    [resourceCollection],
  );
  const serviceList = useMemo(
    () =>
      resources
        .filter((r) => r.type === "service")
        .map((r) => ({ id: r.resourceId, name: r.name })),
    [resources],
  );

  return <LogsPage services={serviceList} initialService={service ?? null} />;
}
