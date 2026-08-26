/**
 * The filter bar: applied filters as removable chips plus a small builder
 * popover (dimension → operator → value, with the top values for that
 * dimension offered as suggestions from a live breakdown query). Filters are
 * URL-owned; this component only proposes the next list.
 */

import { useState } from "react";

import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FILTER_DIMENSIONS,
  FILTER_OPS,
  type FilterDimension,
  type FilterOp,
} from "@otterdeploy/shared/analytics-filters";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  useBreakdown,
} from "../hooks/use-web-analytics";
import { type WebAnalyticsFilter, withoutFilter } from "../lib/filter-codec";

function dimensionLabelKey(dim: FilterDimension): `analytics.filters.dims.${FilterDimension}` {
  return `analytics.filters.dims.${dim}`;
}

const OP_LABEL_KEYS = {
  is: "analytics.filters.is",
  isNot: "analytics.filters.isNot",
  contains: "analytics.filters.contains",
} as const satisfies Record<FilterOp, string>;

export function FilterBar({
  scope,
  win,
  filters,
  onFiltersChange,
}: {
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  filters: readonly WebAnalyticsFilter[];
  onFiltersChange: (next: WebAnalyticsFilter[]) => void;
}) {
  const { t } = useTranslation();
  if (filters.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <AddFilter scope={scope} win={win} filters={filters} onFiltersChange={onFiltersChange} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter, index) => (
        <span
          key={`${filter.dim}-${filter.op}-${filter.value}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted py-0 pr-1 pl-2.5 text-xs"
        >
          <span className="text-muted-foreground">
            {t(dimensionLabelKey(filter.dim))} {t(OP_LABEL_KEYS[filter.op]).toLowerCase()}
          </span>
          <span className="max-w-48 truncate font-mono">{filter.value}</span>
          <button
            type="button"
            aria-label={t("analytics.filters.remove")}
            onClick={() => onFiltersChange(withoutFilter(filters, index))}
            className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
          </button>
        </span>
      ))}
      <AddFilter scope={scope} win={win} filters={filters} onFiltersChange={onFiltersChange} />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground"
        onClick={() => onFiltersChange([])}
      >
        {t("analytics.filters.clear")}
      </Button>
    </div>
  );
}

function AddFilter({
  scope,
  win,
  filters,
  onFiltersChange,
}: {
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  filters: readonly WebAnalyticsFilter[];
  onFiltersChange: (next: WebAnalyticsFilter[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dim, setDim] = useState<FilterDimension>("path");
  const [op, setOp] = useState<FilterOp>("is");
  const [value, setValue] = useState("");

  // Top values for the chosen dimension, offered under the input. Only fires
  // while the popover is open, so the bar costs nothing at rest.
  const suggestions = useBreakdown(scope, win, dim, { limit: 8, enabled: open });

  const dimItems = FILTER_DIMENSIONS.map((d) => ({ value: d, label: t(dimensionLabelKey(d)) }));
  const opItems = FILTER_OPS.map((o) => ({ value: o, label: t(OP_LABEL_KEYS[o]) }));

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    onFiltersChange([...filters, { dim, op, value: trimmed }]);
    setValue("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" />}>
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-3.5" />
        {t("analytics.filters.add")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Select
              items={dimItems}
              value={dim}
              onValueChange={(next) => {
                const match = FILTER_DIMENSIONS.find((d) => d === next);
                if (match) setDim(match);
              }}
            >
              <SelectTrigger aria-label={t("analytics.filters.dimension")} className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={opItems}
              value={op}
              onValueChange={(next) => {
                const match = FILTER_OPS.find((o) => o === next);
                if (match) setOp(match);
              }}
            >
              <SelectTrigger aria-label={t("analytics.filters.operator")} className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(value);
            }}
            placeholder={t("analytics.filters.valuePlaceholder")}
            aria-label={t("analytics.filters.value")}
            className="h-8 font-mono text-xs"
          />
          {suggestions.data && suggestions.data.rows.length > 0 ? (
            <div className="flex max-h-44 flex-col overflow-y-auto">
              {suggestions.data.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => submit(row.key)}
                  className="truncate rounded-sm px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-muted"
                >
                  {row.key}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" disabled={value.trim().length === 0} onClick={() => submit(value)}>
              {t("analytics.filters.apply")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
