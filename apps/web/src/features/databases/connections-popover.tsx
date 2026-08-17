/**
 * Live client-connections breakdown for a postgres resource, shared by the
 * Backups catalog rows and the database panel's status bar. Data comes from
 * `database.connections` (pg_stat_activity, client backends only): see the
 * contract for why the count here matches the catalog card's number.
 */

import type { ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc } from "@/shared/server/orpc";

export function useDbConnections(resourceId: ResourceId, enabled: boolean) {
  return useQuery({
    ...orpc.database.connections.queryOptions({ input: { resourceId } }),
    enabled,
    staleTime: 5_000,
    retry: false,
  });
}

type ConnectionsQuery = ReturnType<typeof useDbConnections>;

/** Popover body: header with the ceiling, then one row per session group. */
export function ConnectionsPopoverBody({
  query,
  total,
}: {
  query: ConnectionsQuery;
  total: number;
}) {
  return (
    <>
      <div className="border-b px-3 py-2 text-xs font-medium">
        Client connections
        {query.data?.maxConnections != null && (
          <span className="ml-1 font-normal text-muted-foreground">
            · {total} of {query.data.maxConnections} max
          </span>
        )}
      </div>
      {query.isPending ? (
        <div className="space-y-2 p-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : query.isError ? (
        <p className="p-3 text-xs text-muted-foreground">
          Couldn't read pg_stat_activity. The database may be unreachable.
        </p>
      ) : query.data.groups.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No client connections right now.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {query.data.groups.map((g, i) => (
            <div
              key={`${g.clientAddr}-${g.user}-${g.applicationName}-${g.state}-${i}`}
              className={`flex items-baseline gap-2 px-3 py-1.5 text-xs ${i > 0 ? "border-t" : ""}`}
            >
              <span className="shrink-0 font-mono">{g.clientAddr}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {g.user}
                {g.applicationName && ` · ${g.applicationName}`}
                {g.state && ` · ${g.state}`}
              </span>
              <span className="shrink-0 font-mono">{g.count}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Status-bar chip for the database panel: a live count that opens the
 * breakdown. Fetches while mounted (panel-scoped, 60s cadence, this is the
 * one place an operator is actively looking at a single database) and
 * renders nothing until the first successful read, so a non-postgres or
 * unreachable database costs no chrome.
 */
export function DbConnectionsChip({ resourceId }: { resourceId: ResourceId }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    ...orpc.database.connections.queryOptions({ input: { resourceId } }),
    refetchInterval: 60_000,
    staleTime: 5_000,
    retry: false,
  });

  if (!query.data) return null;
  const total = query.data.groups.reduce((sum, g) => sum + g.count, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="shrink-0 cursor-pointer rounded-sm text-[13px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground">
        {total === 1 ? "1 connection" : `${total} connections`}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <ConnectionsPopoverBody query={query} total={total} />
      </PopoverContent>
    </Popover>
  );
}
