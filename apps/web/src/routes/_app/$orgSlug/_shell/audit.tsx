/**
 * Audit log: the append-only record of every audit-worthy action across the
 * org — every mutation, and every denial.
 *
 * The first surface on the shared data table. Everything the page used to own
 * by hand — filters, counts, paging, the drawer — now comes from one column
 * declaration and one feed endpoint, and the parts that were untrue got fixed
 * on the way:
 *
 * - Filters live in the URL, so a filtered view is a link an operator can paste
 *   into an incident channel. They were form state before, and could not be.
 * - Options carry counts, from the same filtered set, instead of a bare
 *   distinct list that could not say whether a value would match anything.
 * - Pages are cursor-based with a unique tiebreak. Offset paging over a feed
 *   that is being written to drops and duplicates rows, which on an audit log
 *   is not a cosmetic bug.
 */

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { auditFilterSpecs } from "@otterdeploy/api/routers/audit/table";
import { Temporal } from "@otterdeploy/shared/temporal";

import { LOG_ZONE } from "@/shared/lib/clock";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { AuditFeedRow } from "@otterdeploy/api/routers/audit/contract";
import type { FeedInput } from "@/shared/components/data-table/feed/types";

import {
  auditColumns,
  AUDIT_OUTCOME_ORDER,
  AUDIT_OUTCOME_TONES,
} from "@/features/audit/table/columns";
import { PageHeader } from "@/shared/components/page";
import { DataTable } from "@/shared/components/data-table/data-table";
import { ROW_TINT } from "@/shared/components/data-table/parts/row-tint";
import { FilterStoreProvider } from "@/shared/components/data-table/state/store";
import {
  filterParam,
  filterValuesOf,
  parseSort,
  serializeSort,
  tableSearchSchema,
  type TableSort,
} from "@/shared/components/data-table/state/search-schema";
import { useSearchFilterStore } from "@/shared/components/data-table/state/use-search-store";
import { Button } from "@/shared/components/ui/button";
import { client } from "@/shared/server/orpc";

import { downloadCsv, toCsv } from "@/shared/components/data-table/export-csv";

import { AuditCorrelated } from "../-components/audit-correlated";

// The URL shape. What each of these MEANS lives in `auditFilterSpecs`, which
// both this page and the server compile from; this only says what may appear
// in the address bar.
const searchSchema = tableSearchSchema({
  at: filterParam.timerange(),
  outcome: filterParam.checkbox(),
  action: filterParam.checkbox(),
  actorType: filterParam.checkbox(),
  actor: filterParam.checkbox(),
  targetType: filterParam.checkbox(),
  q: filterParam.text(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/audit")({
  staticData: { crumb: "Audit" },
  validateSearch: searchSchema,
  component: AuditRoute,
});

function AuditRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const filters = useMemo(() => filterValuesOf(search, auditFilterSpecs), [search]);

  const onChange = useCallback(
    (patch: Record<string, unknown>) => {
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
    },
    [navigate],
  );

  const store = useSearchFilterStore({
    tableId: "audit",
    specs: auditFilterSpecs,
    values: filters,
    onChange,
  });

  const sort = parseSort(search.sort);
  const onSortChange = useCallback(
    (next: TableSort | null) => {
      void navigate({
        search: (prev) => ({ ...prev, sort: serializeSort(next) }),
        replace: true,
      });
    },
    [navigate],
  );

  const onOpenRow = useCallback(
    (rowId: string | null) => {
      void navigate({ search: (prev) => ({ ...prev, row: rowId ?? undefined }), replace: true });
    },
    [navigate],
  );

  /**
   * The zone the SERVER buckets and day-bounds in, and it is the same one the
   * table prints — see `LOG_ZONE`.
   *
   * It used to be the viewer's. That made a lone date mean the reader's day,
   * which sounds friendlier and was in fact the bug: the histogram bucketed on
   * Berlin midnight while the rows printed a UTC clock, so a bar and the rows
   * under it disagreed about which day they belonged to.
   */
  const timeZone = LOG_ZONE;

  const fetchPage = useCallback(
    (input: FeedInput) =>
      client.audit.feed({
        filters: input.filters,
        sort: input.sort ?? null,
        cursor: input.cursor ?? null,
        direction: input.direction ?? "next",
        size: input.size ?? 50,
        includeFacets: input.includeFacets ?? true,
        timeZone,
      }),
    [timeZone],
  );

  return (
    /**
     * An instrument surface, not a page with a table on it.
     *
     * This used to be `<Page>` — a 24px gutter, a `gap-6`, and the table inside
     * a rounded ring — with no height bound on any of it. Three things followed
     * and all three were visible: the table grew to its content (2,247px for a
     * page told to be `min-h-0`), so the WINDOW scrolled instead of the rows,
     * taking the toolbar and the histogram off-screen; the filter rail grew with
     * it, so its `border-r` ran 1,980px down the page past everything it was
     * meant to divide; and the gutter meant that rail's edge, the toolbar's
     * bottom rule and the histogram's all stopped at three different places.
     *
     * Bounded to the viewport and full-bleed, the rules meet: the rail's border
     * runs exactly as far as the rows beside it, and each region scrolls itself.
     * The same exception Terminal and Edge logs take, for the same reason.
     */
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden">
      <PageHeader
        title="Audit log"
        description="Append-only record of every administrative action across this workspace, including denials."
        className="shrink-0 px-4 py-4 sm:px-6 sm:py-5"
      />
      <FilterStoreProvider store={store}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t">
          <DataTable<AuditFeedRow>
            columns={auditColumns}
            queryKey={["audit", "feed"]}
            fetchPage={fetchPage}
            getRowId={(row) => row.id}
            rowTitle={(row) => <span className="font-mono">{row.action}</span>}
            filters={filters}
            sort={sort}
            onSortChange={onSortChange}
            openRowId={search.row ?? null}
            onOpenRow={onOpenRow}
            timeKey="at"
            live
            histogramTones={AUDIT_OUTCOME_TONES}
            histogramOrder={AUDIT_OUTCOME_ORDER}
            histogramKey="outcome"
            searchPlaceholder="Search actions, actors, targets"
            emptyTitle="No audit events yet"
            emptyDescription="Mutations and denials appear here as they happen."
            rowClassName={(row) => (row.outcome === "denied" ? ROW_TINT.danger : undefined)}
            actions={({ rows }) => <ExportButton rows={rows} />}
            sheetExtra={(row) => <AuditCorrelated row={row} onOpenRow={onOpenRow} />}
          />
        </div>
      </FilterStoreProvider>
    </div>
  );
}

/**
 * Exports what is LOADED, and says so on the tooltip.
 *
 * Exporting the whole filtered set would mean paging the feed to its end behind
 * a button that looks instant, so the honest offer is the rows in hand.
 */
function ExportButton({ rows }: { rows: AuditFeedRow[] }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5"
      disabled={rows.length === 0}
      onClick={() =>
        downloadCsv(
          `audit-${Temporal.Now.plainDateISO().toString()}.csv`,
          toCsv(rows, auditColumns),
        )
      }
      title={`Export the ${rows.length} rows loaded so far`}
    >
      <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
      Export
    </Button>
  );
}
