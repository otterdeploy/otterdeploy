/**
 * Audit filter bar — range / custom dates / actor / action / target / outcome
 * / search. The form itself is created by the route (`useAuditFilterForm`) so
 * the route keeps deriving its query input from the same store; this file owns
 * the option sources (the `audit.distinct` query) and the controls' rendering.
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

// Base UI <SelectValue> renders the selected option's *label* only when the
// root <Select> is given a matching `items` list — see the outcome filter.
const OUTCOME_ITEMS: { label: string; value: string }[] = [
  { label: "All outcomes", value: "any" },
  { label: "Success", value: "success" },
  { label: "Denied", value: "denied" },
  { label: "Failed", value: "failure" },
];

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
 *  it as an extra option so the native select doesn't silently blank while
 *  the filter is still applied. */
function useFilterOptions(filter: AuditFilter, queryFilter: AuditFilter) {
  const distinct = useQuery({
    ...orpc.audit.distinct.queryOptions({ input: auditWindow(queryFilter) }),
    queryKey: ["audit", "distinct", filter.range, filter.from, filter.to],
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
