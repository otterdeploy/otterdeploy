/**
 * The one shell every breakdown card shares: title + optional dimension
 * switcher + "See all", over a fixed six-row body so the grid never jumps as
 * data arrives. Rows carry a hairline share bar under the text — a quiet
 * proportion, not a solid block — and clicking a row narrows the whole page
 * to that value.
 */

import type { BreakdownDimension } from "@otterdeploy/shared/analytics-filters";

import type { ReactNode } from "react";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

import { formatCount } from "../../analytics-model";

export interface BreakdownRowData {
  key: string;
  visitors: number;
  share: number;
  conversions?: number;
  conversionRate?: number;
}

export interface DimensionOption {
  value: BreakdownDimension;
  label: string;
}

const ROW_COUNT = 6;
/** Six rows at h-9: the body's one fixed height, loading or loaded. */
const BODY_HEIGHT = "h-[13.5rem]";

export function BreakdownCard({
  title,
  dimensions,
  dimension,
  onDimensionChange,
  onSeeAll,
  headerExtra,
  loading,
  rows,
  renderLeading,
  displayKey,
  mono = true,
  formatValue,
  onRowClick,
  selectedKey,
  body,
}: {
  title: string;
  dimensions?: readonly DimensionOption[];
  dimension?: BreakdownDimension;
  onDimensionChange?: (next: BreakdownDimension) => void;
  onSeeAll?: () => void;
  headerExtra?: ReactNode;
  loading: boolean;
  rows: readonly BreakdownRowData[];
  renderLeading?: (key: string) => ReactNode;
  displayKey?: (key: string) => string;
  mono?: boolean;
  /** Right column; defaults to the visitors count. */
  formatValue?: (row: BreakdownRowData) => string;
  onRowClick?: (key: string) => void;
  /** The row currently applied as a filter (toggle-style cards). */
  selectedKey?: string;
  /** Replaces the row list entirely (the Locations map). */
  body?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col rounded-lg bg-card ring-1 ring-foreground/10">
      {/* min-h matches the h-7 dimension select so cards without one keep
          the same header height and their rows line up across the grid. */}
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-3.5 py-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
        {headerExtra}
        {dimensions && dimensions.length > 1 && dimension !== undefined && onDimensionChange ? (
          <Select
            items={[...dimensions]}
            value={dimension}
            onValueChange={(next) => {
              const match = dimensions.find((d) => d.value === next);
              if (match) onDimensionChange(match.value);
            }}
          >
            <SelectTrigger aria-label={title} className="h-7 w-auto gap-1 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dimensions.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {onSeeAll ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-0.5 px-2 text-xs text-muted-foreground"
            onClick={onSeeAll}
          >
            {t("analytics.overview.seeAll")}
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        ) : null}
      </header>
      <div className={cn("flex flex-col overflow-hidden px-2 py-1.5", BODY_HEIGHT)}>
        {body ??
          (loading ? (
            <RowSkeletons />
          ) : rows.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              {t("analytics.overview.noData")}
            </p>
          ) : (
            rows
              .slice(0, ROW_COUNT)
              .map((row) => (
                <BreakdownRow
                  key={row.key}
                  row={row}
                  maxShare={rows[0]?.share ?? 0}
                  leading={renderLeading?.(row.key)}
                  label={displayKey ? displayKey(row.key) : row.key}
                  mono={mono}
                  value={formatValue ? formatValue(row) : undefined}
                  selected={selectedKey !== undefined && row.key === selectedKey}
                  onClick={
                    onRowClick && row.key !== "(none)" ? () => onRowClick(row.key) : undefined
                  }
                />
              ))
          ))}
      </div>
    </section>
  );
}

function RowSkeletons() {
  return (
    <>
      {Array.from({ length: ROW_COUNT }, (_, i) => (
        <div key={i} className="flex h-9 items-center px-1.5">
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </>
  );
}

function BreakdownRow({
  row,
  maxShare,
  leading,
  label,
  mono,
  value,
  selected,
  onClick,
}: {
  row: BreakdownRowData;
  maxShare: number;
  leading: ReactNode;
  label: string;
  mono: boolean;
  value: string | undefined;
  selected: boolean;
  onClick: (() => void) | undefined;
}) {
  const barWidth = maxShare > 0 ? `${Math.max((row.share / maxShare) * 100, 2)}%` : "0%";
  const content = (
    <>
      <span className="flex w-full min-w-0 items-center gap-2">
        {leading}
        <span
          className={cn("min-w-0 flex-1 truncate text-left text-xs", mono && "font-mono")}
          title={label}
        >
          {label}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums">
          {value ?? formatCount(row.visitors)}
        </span>
      </span>
      <span aria-hidden="true" className="block h-0.5 w-full">
        <span
          className="block h-full rounded-full bg-foreground/15 transition-all"
          style={{ width: barWidth }}
        />
      </span>
    </>
  );
  if (!onClick) {
    return <div className="flex h-9 flex-col justify-center gap-1 px-1.5">{content}</div>;
  }
  // The applied row keeps a resting tint, the way a chip in the filter bar
  // does: the selection is a fact about the page, not a hover.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex h-9 flex-col justify-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "bg-muted",
      )}
    >
      {content}
    </button>
  );
}
