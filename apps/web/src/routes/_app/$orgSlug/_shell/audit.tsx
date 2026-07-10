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
import { Download01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useForm, useStore } from "@tanstack/react-form";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  auditCollection,
  auditSubsetKey,
  auditWindow,
  DEFAULT_AUDIT_FILTER,
  RANGES,
  toAuditInput,
  type AuditEvent,
} from "@/features/audit/data/audit";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/shared/components/ui/native-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc } from "@/shared/server/orpc";

import { exportCsv, useDebouncedValue } from "../-components/audit-helpers";
import { EventDrawer, StatTile } from "../-components/audit-parts";
import { AuditTableSection } from "../-components/audit-table";

export const Route = createFileRoute("/_app/$orgSlug/_shell/audit")({
  staticData: { crumb: "Audit" },
  component: AuditRoute,
});

// Base UI <SelectValue> renders the selected option's *label* only when the
// root <Select> is given a matching `items` list — see the outcome filter.
const OUTCOME_ITEMS: { label: string; value: string }[] = [
  { label: "All outcomes", value: "any" },
  { label: "Success", value: "success" },
  { label: "Denied", value: "denied" },
  { label: "Failed", value: "failure" },
];

function AuditRoute() {
  // The whole event rides in state (not just an id): correlated-event
  // navigation can open events that aren't in the loaded page, so deriving
  // the open event from `items` would come up empty for them.
  const [openEvent, setOpenEvent] = useState<AuditEvent | null>(null);

  // Filters live in a TanStack Form used purely as a reactive state container.
  // No submit — `useStore` re-renders on every value change, which re-derives
  // the query input below.
  const form = useForm({ defaultValues: DEFAULT_AUDIT_FILTER });
  const filter = useStore(form.store, (s) => s.values);

  // Each distinct filter is its own on-demand collection subset, so typing in
  // the search box would refetch on every keystroke. Debounce the term that
  // reaches the queries while the input itself stays instant.
  const debouncedQ = useDebouncedValue(filter.q, 250);

  // Memoize so `from` (which reads "now") is stable across renders and doesn't
  // thrash the subset / query keys.
  const queryFilter = useMemo(
    () => ({ ...filter, q: debouncedQ }),
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

  // Distinct actor / action / target-kind values over the *time window only*
  // (not the other filters) — so picking one option doesn't make the rest
  // vanish from their dropdowns. Same stable-key trick as the stats query.
  const distinct = useQuery({
    ...orpc.audit.distinct.queryOptions({ input: auditWindow(queryFilter) }),
    queryKey: ["audit", "distinct", filter.range, filter.from, filter.to],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

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
    queryKey: ["audit", "stats", key],
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

  // Select options come from the distinct query; if the current selection has
  // aged out of the window, keep it as an extra option so the native select
  // doesn't silently blank while the filter is still applied.
  const actorOptions = useMemo(() => {
    const opts = (distinct.data?.actors ?? []).map((a) => ({
      value: a.id,
      label: a.label ?? a.email ?? a.id,
    }));
    return withCurrent(opts, filter.actor);
  }, [distinct.data?.actors, filter.actor]);
  const actionOptions = useMemo(
    () =>
      withCurrent(
        (distinct.data?.actions ?? []).map((a) => ({ value: a, label: a })),
        filter.action,
      ),
    [distinct.data?.actions, filter.action],
  );
  const targetOptions = useMemo(
    () =>
      withCurrent(
        (distinct.data?.targetTypes ?? []).map((t) => ({ value: t, label: t })),
        filter.targetType,
      ),
    [distinct.data?.targetTypes, filter.targetType],
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <form.Field name="range">
          {(field) => (
            <NativeSelect
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              className="h-8 w-36"
            >
              {RANGES.map((r) => (
                <NativeSelectOption key={r.id} value={r.id}>
                  {r.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </form.Field>
        {filter.range === "custom" && (
          <div className="flex items-center gap-1.5">
            <form.Field name="from">
              {(field) => (
                <Input
                  type="date"
                  aria-label="From date"
                  value={field.state.value}
                  max={filter.to || undefined}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="h-8 w-36"
                />
              )}
            </form.Field>
            <span className="text-xs text-muted-foreground">–</span>
            <form.Field name="to">
              {(field) => (
                <Input
                  type="date"
                  aria-label="To date"
                  value={field.state.value}
                  min={filter.from || undefined}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="h-8 w-36"
                />
              )}
            </form.Field>
          </div>
        )}
        <form.Field name="actor">
          {(field) => (
            <FilterSelect
              value={field.state.value}
              onChange={field.handleChange}
              anyLabel="All actors"
              options={actorOptions}
              className="w-44"
            />
          )}
        </form.Field>
        <form.Field name="action">
          {(field) => (
            <FilterSelect
              value={field.state.value}
              onChange={field.handleChange}
              anyLabel="All actions"
              options={actionOptions}
              className="w-44"
            />
          )}
        </form.Field>
        <form.Field name="targetType">
          {(field) => (
            <FilterSelect
              value={field.state.value}
              onChange={field.handleChange}
              anyLabel="All targets"
              options={targetOptions}
              className="w-36"
            />
          )}
        </form.Field>
        <form.Field name="outcome">
          {(field) => (
            <Select
              items={OUTCOME_ITEMS}
              value={field.state.value}
              onValueChange={(v) => field.handleChange(v ?? field.state.value)}
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTCOME_ITEMS.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
        <div className="relative ml-auto">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <form.Field name="q">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Search action / actor / target"
                className="h-8 w-64 pl-8"
              />
            )}
          </form.Field>
        </div>
      </div>

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

/** Inject the current selection into the option list when the distinct query
 *  no longer returns it (window changed) — a native select with a value that
 *  has no matching <option> renders blank while still filtering. */
function withCurrent(
  options: { value: string; label: string }[],
  current: string,
): { value: string; label: string }[] {
  if (current === "any" || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: current }];
}

/** "Any + distinct values" native select shared by the actor / action /
 *  target-kind filters. */
function FilterSelect({
  value,
  onChange,
  anyLabel,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  anyLabel: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 ${className ?? ""}`}
    >
      <NativeSelectOption value="any">{anyLabel}</NativeSelectOption>
      {options.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
