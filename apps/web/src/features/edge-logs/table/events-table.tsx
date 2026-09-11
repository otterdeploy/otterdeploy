/**
 * The Events pane: Caddy's operational log on the shared table shell.
 *
 * What it replaces — `edge-events-view.tsx` and its parts, 338 lines — owned a
 * range segmented control, two rows of chips, a host dropdown, a search box, a
 * wrap toggle, a pause button and its own `<table>`. Every one of those is a
 * question the shell had already answered, and answered better: the filters now
 * live in the URL, so a filtered view is a link; the options carry counts from
 * the same filtered set; and the histogram is over exactly the rows shown.
 *
 * Search params belong to the `edge` route, which this pane is a tab of, so
 * they are read through its route api rather than re-declared. Switching tab or
 * pane there REPLACES the whole search object, which is what keeps this table's
 * filter keys from following the reader into the Access logs pane.
 */

import type { EdgeEventFeedRow } from "@otterdeploy/api/routers/edge-logs/contract";

import { useCallback, useMemo, useState } from "react";

import { edgeEventFilterSpecs } from "@otterdeploy/api/routers/edge-logs/events-table";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { FeedInput } from "@/shared/components/data-table/feed/types";

import {
  edgeEventColumns,
  EDGE_EVENT_LEVEL_ORDER,
  EDGE_EVENT_LEVEL_TONES,
} from "@/features/edge-logs/table/events-columns";
import { DataTable } from "@/shared/components/data-table/data-table";
import { ROW_TINT } from "@/shared/components/data-table/parts/row-tint";
import {
  filterValuesOf,
  parseSort,
  serializeSort,
  type TableSort,
} from "@/shared/components/data-table/state/search-schema";
import { FilterStoreProvider } from "@/shared/components/data-table/state/store";
import { useSearchFilterStore } from "@/shared/components/data-table/state/use-search-store";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { LOG_ZONE } from "@/shared/lib/clock";
import { client } from "@/shared/server/orpc";

const routeApi = getRouteApi("/_app/$orgSlug/_shell/edge");

/**
 * Whether this install is recording Caddy's operational log at all.
 *
 * Two different absences, and the table renders identically for both: the sink
 * unset means the log never reached us, persistence off means it reached us and
 * went only to the in-memory ring this feed cannot read. Neither is a time
 * range the reader can widen their way out of, so the pane says which it is.
 */
interface Collection {
  sinkConfigured: boolean;
  persisting: boolean;
}

function CollectionNotice({ status }: { status: Collection | null }) {
  const { t } = useTranslation();
  if (status === null) return null;
  if (status.sinkConfigured && status.persisting) return null;
  return (
    <Alert className="mx-4 mt-3 w-auto">
      <AlertDescription className="text-[13px] text-muted-foreground">
        {status.sinkConfigured ? t("edgeLogs.eventsNotPersisted") : t("edgeLogs.eventsSinkOff")}
      </AlertDescription>
    </Alert>
  );
}

export function EdgeEventsTable() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);

  const filters = useMemo(() => filterValuesOf(search, edgeEventFilterSpecs), [search]);

  const onChange = useCallback(
    (patch: Record<string, unknown>) => {
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
    },
    [navigate],
  );

  const store = useSearchFilterStore({
    tableId: "edge-events",
    specs: edgeEventFilterSpecs,
    values: filters,
    onChange,
  });

  const sort = parseSort(search.sort);
  const onSortChange = useCallback(
    (next: TableSort | null) => {
      void navigate({ search: (prev) => ({ ...prev, sort: serializeSort(next) }), replace: true });
    },
    [navigate],
  );

  const onOpenRow = useCallback(
    (rowId: string | null) => {
      void navigate({ search: (prev) => ({ ...prev, row: rowId ?? undefined }), replace: true });
    },
    [navigate],
  );

  const fetchPage = useCallback(async (input: FeedInput) => {
    const page = await client.edgeLogs.events.feed({
      filters: input.filters,
      sort: input.sort ?? null,
      cursor: input.cursor ?? null,
      direction: input.direction ?? "next",
      size: input.size ?? 50,
      includeFacets: input.includeFacets ?? true,
      // The zone the SERVER buckets and day-bounds in, and the one the table
      // prints — see `LOG_ZONE`. A viewer's zone here would bucket the
      // histogram on their midnight while the rows printed a UTC clock.
      timeZone: LOG_ZONE,
    });
    // Set in the callback that learns it, not in an effect watching for it.
    // Compared first so a page that agrees with the last one is not a render.
    setCollection((previous) =>
      previous?.sinkConfigured === page.sinkConfigured && previous.persisting === page.persisting
        ? previous
        : { sinkConfigured: page.sinkConfigured, persisting: page.persisting },
    );
    return page;
  }, []);

  return (
    <FilterStoreProvider store={store}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CollectionNotice status={collection} />
        <DataTable<EdgeEventFeedRow>
          columns={edgeEventColumns}
          queryKey={["edge-logs", "events", "feed"]}
          fetchPage={fetchPage}
          getRowId={(row) => row.id}
          rowTitle={(row) => <span className="font-mono">{row.logger}</span>}
          filters={filters}
          sort={sort}
          onSortChange={onSortChange}
          openRowId={search.row ?? null}
          onOpenRow={onOpenRow}
          timeKey="ts"
          live
          histogramTones={EDGE_EVENT_LEVEL_TONES}
          histogramOrder={EDGE_EVENT_LEVEL_ORDER}
          histogramKey="level"
          searchPlaceholder="Search messages, errors, loggers"
          emptyTitle="No edge events in this window"
          emptyDescription="Certificate, upstream and config activity appears here as Caddy reports it."
          // An error is the row this table exists for, so it carries a tint
          // rather than relying on the level chip alone.
          rowClassName={(row) => (row.level === "error" ? ROW_TINT.danger : undefined)}
        />
      </div>
    </FilterStoreProvider>
  );
}
