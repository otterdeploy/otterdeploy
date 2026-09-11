/**
 * The edge access log on the shared table shell.
 *
 * What it replaces — `edge-logs-view.tsx` and its parts — owned a range
 * segmented control, a status-class chip row, a method chip row, a host
 * dropdown, a search box, a suspicious toggle, a wrap toggle, a pause button, a
 * histogram and its own `<table>` with an expand-a-row panel. Every one of
 * those is a question the shell had already answered, and answered better: the
 * filters are in the URL, the options carry counts from the same filtered set,
 * and the histogram is over exactly the rows shown.
 *
 * It renders in TWO places — Edge → Access logs, and the project Logs page's
 * Edge source — which is why the search params arrive as props instead of
 * through a route api. TanStack validates search per route, so each site owns
 * its own schema and hands this the values.
 */

import type { EdgeAccessFeedRow } from "@otterdeploy/api/routers/edge-logs/contract";
import type { ProjectId } from "@otterdeploy/shared/id";

import { useCallback, useState } from "react";

import { edgeAccessFilterSpecs } from "@otterdeploy/api/routers/edge-logs/access-table";
import { Temporal } from "@otterdeploy/shared/temporal";

import type { FeedInput } from "@/shared/components/data-table/feed/types";

import { useEdgeBans } from "@/features/edge-logs/data/use-edge-bans";
import { AccessLogToolbarActions, BlockIpAction } from "@/features/edge-logs/table/access-actions";
import {
  edgeAccessColumns,
  EDGE_ACCESS_STATUS_ORDER,
  EDGE_ACCESS_STATUS_TONES,
} from "@/features/edge-logs/table/access-columns";
import { DataTable } from "@/shared/components/data-table/data-table";
import { downloadCsv, toCsv } from "@/shared/components/data-table/export-csv";
import { ROW_TINT } from "@/shared/components/data-table/parts/row-tint";
import { FilterStoreProvider } from "@/shared/components/data-table/state/store";
import { useTableSurface } from "@/shared/components/data-table/state/use-table-surface";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { LOG_ZONE } from "@/shared/lib/clock";
import { client } from "@/shared/server/orpc";

/** See the events pane's notice: two different absences, one empty table. */
interface Collection {
  sinkConfigured: boolean;
  persisting: boolean;
}

function CollectionNotice({ status }: { status: Collection | null }) {
  if (status === null || (status.sinkConfigured && status.persisting)) return null;
  return (
    <Alert className="mx-4 mt-3 w-auto">
      <AlertDescription className="text-[13px] text-muted-foreground">
        {status.sinkConfigured
          ? "Requests are reaching the edge but are not being stored (EDGE_LOG_PERSIST is off), so only the live tail has them and this table, which reads the database, stays empty."
          : "Access-log collection is off on this install (EDGE_LOG_SINK is unset), so nothing can appear here — Caddy is writing its access log to the edge container's own output instead."}
      </AlertDescription>
    </Alert>
  );
}

export interface EdgeAccessTableProps {
  /** Narrow the host scope to one project's domains. Absent = the whole org. */
  projectId?: ProjectId;
  /** The route's search bag. Filter values are read out of it by `coerce`. */
  search: Record<string, unknown>;
  /** Merge a patch into the route's search params, replacing history. */
  onSearchChange: (patch: Record<string, unknown>) => void;
}

export function EdgeAccessTable({ projectId, search, onSearchChange }: EdgeAccessTableProps) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const { bannedIps, blockIp, blockAll, canBlock } = useEdgeBans();

  const { filters, store, sort, onSortChange, openRowId, onOpenRow } = useTableSurface({
    // Per scope, so a project's remembered columns and widths are its own — the
    // org-wide view and a project's are read at different zoom levels.
    tableId: projectId ? `edge-access:${projectId}` : "edge-access",
    specs: edgeAccessFilterSpecs,
    search,
    onSearchChange,
  });

  const fetchPage = useCallback(
    async (input: FeedInput) => {
      const page = await client.edgeLogs.feed({
        filters: input.filters,
        sort: input.sort ?? null,
        cursor: input.cursor ?? null,
        direction: input.direction ?? "next",
        size: input.size ?? 50,
        includeFacets: input.includeFacets ?? true,
        ...(projectId ? { projectId } : {}),
        // The zone the SERVER buckets and day-bounds in, and the one the table
        // prints — see `LOG_ZONE`.
        timeZone: LOG_ZONE,
      });
      // Set in the callback that learns it, not in an effect watching for it.
      setCollection((previous) =>
        previous?.sinkConfigured === page.sinkConfigured && previous.persisting === page.persisting
          ? previous
          : { sinkConfigured: page.sinkConfigured, persisting: page.persisting },
      );
      return page;
    },
    [projectId],
  );

  const rowActions = useCallback(
    (row: EdgeAccessFeedRow) => (
      <BlockIpAction
        row={row}
        onBlockIp={async (ip, hours) => blockIp(ip, hours)}
        bannedIps={bannedIps}
        canBlock={canBlock}
      />
    ),
    [bannedIps, blockIp, canBlock],
  );

  return (
    <FilterStoreProvider store={store}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CollectionNotice status={collection} />
        <DataTable<EdgeAccessFeedRow>
          columns={edgeAccessColumns}
          queryKey={["edge-logs", "feed", projectId ?? "org"]}
          fetchPage={fetchPage}
          getRowId={(row) => row.id}
          rowTitle={(row) => (
            <span className="font-mono">
              {row.method} {row.path}
            </span>
          )}
          filters={filters}
          sort={sort}
          onSortChange={onSortChange}
          openRowId={openRowId}
          onOpenRow={onOpenRow}
          timeKey="ts"
          live
          histogramTones={EDGE_ACCESS_STATUS_TONES}
          histogramOrder={EDGE_ACCESS_STATUS_ORDER}
          histogramKey="statusClass"
          searchPlaceholder="Search paths, hosts, IPs, agents"
          emptyTitle="No requests in this window"
          emptyDescription="Every request the edge served appears here."
          // A 5xx is the row this table exists for, so it carries a tint rather
          // than relying on the status column alone.
          rowClassName={(row) => (row.statusClass === "5xx" ? ROW_TINT.danger : undefined)}
          actions={({ rows }) => (
            <AccessLogToolbarActions
              rows={rows}
              // Only when the rows in hand are ALREADY narrowed to probes: a
              // "Block all" over an unfiltered access log would ban every
              // visitor on the page.
              suspiciousOnly={rows.length > 0 && rows.every((row) => row.suspicious === "yes")}
              onBlockAll={async (ips, hours) => blockAll(ips, hours)}
              onExport={(rows) =>
                downloadCsv(
                  `edge-access-${Temporal.Now.plainDateISO().toString()}.csv`,
                  toCsv([...rows], edgeAccessColumns),
                )
              }
              bannedIps={bannedIps}
              canBlock={canBlock}
            />
          )}
          rowActions={rowActions}
        />
      </div>
    </FilterStoreProvider>
  );
}
