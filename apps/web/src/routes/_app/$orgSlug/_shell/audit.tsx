/**
 * Audit log — queryable, append-only record of every audit-worthy action
 * (mutations + all denials) across the org.
 *
 * Filters are a TanStack Form (used as a reactive container — no submit; value
 * changes drive the reads). Rows ride a TanStack DB query collection consumed
 * via `useLiveQuery`; the server-truth aggregates (`counts`/`total`) the
 * collection can't represent come from a tiny companion query. See
 * `features/audit/data/audit.ts` for why the reads are split this way.
 */
import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-form";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  auditCollection,
  auditSubsetKey,
  toAuditInput,
  type AuditEvent,
} from "@/features/audit/data/audit";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

import { AuditFilters, useAuditFilterForm } from "../-components/audit-filters";
import { EventDrawer } from "../-components/audit-drawer";
import { exportCsv, useDebouncedValue } from "../-components/audit-helpers";
import { StatTile } from "../-components/audit-parts";
import { AuditTableSection } from "../-components/audit-table";

export const Route = createFileRoute("/_app/$orgSlug/_shell/audit")({
  staticData: { crumb: "Audit" },
  component: AuditRoute,
});

function AuditRoute() {
  // The whole event rides in state (not just an id): correlated-event
  // navigation can open events that aren't in the loaded page, so deriving
  // the open event from `items` would come up empty for them.
  const [openEvent, setOpenEvent] = useState<AuditEvent | null>(null);

  const form = useAuditFilterForm();
  const filter = useStore(form.store, (s) => s.values);

  // Each distinct filter is its own on-demand collection subset, so typing in
  // the search box would refetch on every keystroke. Debounce the term that
  // reaches the queries while the input itself stays instant.
  const debouncedQ = useDebouncedValue(filter.q, 250);

  // Memoize so `from` (which reads "now") is stable across renders and doesn't
  // thrash the subset / query keys.
  const queryFilter = useMemo(
    () => ({
      range: filter.range,
      from: filter.from,
      to: filter.to,
      outcome: filter.outcome,
      actor: filter.actor,
      action: filter.action,
      targetType: filter.targetType,
      q: debouncedQ,
      limit: filter.limit,
    }),
    [
      filter.range,
      filter.from,
      filter.to,
      filter.outcome,
      filter.actor,
      filter.action,
      filter.targetType,
      debouncedQ,
      filter.limit,
    ],
  );
  const input = useMemo(() => toAuditInput(queryFilter), [queryFilter]);
  const key = useMemo(() => auditSubsetKey(queryFilter), [queryFilter]);

  // Companion read for the server-truth aggregates the collection can't hold.
  // `limit: 1` keeps the payload tiny — `counts`/`total` span the whole filtered
  // set regardless of limit. Also the page's loading / error / retry source.
  // Key on the *filter selection* (`key`), not the resolved input — same trick
  // as the rows subset. `input.from` is recomputed from "now" on every mount, so
  // keying on it made each remount a cache miss and flashed the full loading
  // state on every return to the route. The queryFn still sends the fresh
  // `from`; only the cache identity is stabilized.
  const stats = useQuery({
    ...orpc.audit.list.queryOptions({ input: { ...input, limit: 1 } }),
    queryKey: [...orpc.audit.list.key(), "stats", key],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const counts = stats.data?.counts ?? { total: 0, failed: 0, denied: 0 };
  const total = stats.data?.total ?? 0;

  // Rows ride the query collection: the `eq(a.key, …)` filter forwards as a
  // subset load, so this both fetches the page and subscribes to it live.
  const { data: items } = useLiveQuery(
    (q) =>
      q
        .from({ a: auditCollection })
        .where(({ a }) => eq(a.key, key))
        .orderBy(({ a }) => a.timestamp, "desc")
        .limit(queryFilter.limit),
    [key, queryFilter.limit],
  );

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Append-only record of every administrative action across this workspace — mutations and denials."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={items.length === 0}
            onClick={() => exportCsv(items)}
          >
            <HugeiconsIcon
              icon={Download01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            Export CSV
          </Button>
        }
      />

      <AuditFilters form={form} filter={filter} queryFilter={queryFilter} />

      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Events" value={counts.total} sub="matching filters" />
        <StatTile
          label="Failed"
          value={counts.failed}
          sub="errored actions"
          tone={counts.failed > 0 ? "warn" : undefined}
        />
        <StatTile
          label="Denied"
          value={counts.denied}
          sub="authz-blocked"
          tone={counts.denied > 0 ? "danger" : undefined}
        />
      </div>

      {/* Table */}
      <AuditTableSection
        items={items}
        total={total}
        isLoading={stats.isLoading}
        isError={stats.isError}
        isFetching={stats.isFetching}
        errorMessage={stats.error?.message}
        onRetry={() => void stats.refetch()}
        onOpen={setOpenEvent}
        onLoadMore={() => form.setFieldValue("limit", filter.limit + 50)}
      />

      <EventDrawer
        event={openEvent}
        onClose={() => setOpenEvent(null)}
        onSelect={setOpenEvent}
      />
    </Page>
  );
}
