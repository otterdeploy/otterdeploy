/**
 * Audit filter bar — range / custom dates / actor / action / target / outcome
 * / search. The form itself is created by the route (`useAuditFilterForm`) so
 * the route keeps deriving its query input from the same store; this file owns
 * the option sources (the `audit.distinct` query) and the controls' rendering.
 *
 * Every categorical control is a searchable Combobox (Base UI) rather than a
 * plain select — the actor / action / target lists can run to dozens of
 * distinct values, so type-to-filter is the only usable affordance. The range
 * ("time rate") and outcome pickers use the same control for one coherent bar.
 */
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  auditWindow,
  DEFAULT_AUDIT_FILTER,
  RANGES,
  type AuditFilter,
} from "@/features/audit/data/audit";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

interface FilterOption {
  value: string;
  label: string;
}

const OUTCOME_OPTIONS: FilterOption[] = [
  { label: "Success", value: "success" },
  { label: "Denied", value: "denied" },
  { label: "Failed", value: "failure" },
];

const RANGE_OPTIONS: FilterOption[] = RANGES.map((r) => ({ value: r.id, label: r.label }));

/** Filters live in a TanStack Form used purely as a reactive state container.
 *  No submit — the route's `useStore` re-renders on every value change. */
export function useAuditFilterForm() {
  return useForm({ defaultValues: DEFAULT_AUDIT_FILTER });
}
export type AuditFilterForm = ReturnType<typeof useAuditFilterForm>;

/** Distinct actor / action / target-kind values over the *time window only*
 *  (not the other filters) — so picking one option doesn't make the rest
 *  vanish from their dropdowns. Same stable-key trick as the stats query.
 *  If the current selection has aged out of the window, `withCurrent` keeps
 *  it as an extra option so the control doesn't silently blank while the
 *  filter is still applied. */
function useFilterOptions(filter: AuditFilter, queryFilter: AuditFilter) {
  const distinct = useQuery({
    ...orpc.audit.distinct.queryOptions({ input: auditWindow(queryFilter) }),
    queryKey: [...orpc.audit.distinct.key(), filter.range, filter.from, filter.to],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

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

  return { actorOptions, actionOptions, targetOptions };
}

export function AuditFilters({
  form,
  filter,
  queryFilter,
}: {
  form: AuditFilterForm;
  /** Live (undebounced) filter values — drives the visible controls. */
  filter: AuditFilter;
  /** Debounced filter — the one the route queries with; keys the distinct query. */
  queryFilter: AuditFilter;
}) {
  const { actorOptions, actionOptions, targetOptions } = useFilterOptions(filter, queryFilter);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form.Field name="range">
        {(field) => (
          <FilterCombobox
            value={field.state.value}
            onChange={field.handleChange}
            options={RANGE_OPTIONS}
            searchPlaceholder="Time range…"
            className="w-40"
          />
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
          <FilterCombobox
            value={field.state.value}
            onChange={field.handleChange}
            anyLabel="All actors"
            searchPlaceholder="Search actors…"
            options={actorOptions}
            className="w-48"
          />
        )}
      </form.Field>
      <form.Field name="action">
        {(field) => (
          <FilterCombobox
            value={field.state.value}
            onChange={field.handleChange}
            anyLabel="All actions"
            searchPlaceholder="Search actions…"
            options={actionOptions}
            className="w-48"
          />
        )}
      </form.Field>
      <form.Field name="targetType">
        {(field) => (
          <FilterCombobox
            value={field.state.value}
            onChange={field.handleChange}
            anyLabel="All targets"
            searchPlaceholder="Search targets…"
            options={targetOptions}
            className="w-40"
          />
        )}
      </form.Field>
      <form.Field name="outcome">
        {(field) => (
          <FilterCombobox
            value={field.state.value}
            onChange={field.handleChange}
            anyLabel="All outcomes"
            searchPlaceholder="Search outcomes…"
            options={OUTCOME_OPTIONS}
            className="w-40"
          />
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
  );
}

/** Inject the current selection into the option list when the distinct query
 *  no longer returns it (window changed) — a control with a value that has no
 *  matching option renders blank while still filtering. */
function withCurrent(options: FilterOption[], current: string): FilterOption[] {
  if (current === "any" || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: current }];
}

/**
 * Searchable single-select used by every categorical audit filter. Options are
 * `{ value, label }`; when `anyLabel` is given an "Any" sentinel (value `"any"`)
 * is prepended so clearing the filter is one click. The range picker omits it —
 * a time window is always one of the presets.
 */
function FilterCombobox({
  value,
  onChange,
  anyLabel,
  options,
  className,
  searchPlaceholder,
}: {
  value: string;
  onChange: (v: string) => void;
  anyLabel?: string;
  options: FilterOption[];
  className?: string;
  searchPlaceholder?: string;
}) {
  const items = useMemo<FilterOption[]>(
    () => (anyLabel ? [{ value: "any", label: anyLabel }, ...options] : options),
    [anyLabel, options],
  );
  const selected = items.find((o) => o.value === value) ?? items[0] ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      onValueChange={(item: FilterOption | null) =>
        onChange(item ? item.value : anyLabel ? "any" : value)
      }
      itemToStringLabel={(item: FilterOption) => item.label}
      isItemEqualToValue={(a: FilterOption, b: FilterOption) => a.value === b.value}
    >
      <ComboboxInput
        placeholder={searchPlaceholder}
        className={cn("h-8", className)}
      />
      <ComboboxContent>
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(item: FilterOption) => (
            <ComboboxItem key={item.value} value={item} className="text-[13px]">
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
