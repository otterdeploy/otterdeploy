/**
 * "See all" drill-in for a breakdown card: the full ranked table with the
 * per-dimension extra columns, a client-side search over what's loaded, and
 * offset paging. Rows are the same affordance as card rows — click to filter
 * the whole page — so the dialog is a bigger lens, not a different tool.
 */

import type { BreakdownDimension, FilterDimension } from "@otterdeploy/shared/analytics-filters";

import { useState } from "react";

import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

import { countryName, formatCount, formatShare } from "../../analytics-model";
import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  useBreakdown,
} from "../../hooks/use-web-analytics";
import { formatDurationMs } from "../../lib/format-duration";

const PAGE_SIZE = 50;
const MAX_LIMIT = 500;

interface Row {
  key: string;
  visitors: number;
  pageviews?: number;
  sessions?: number;
  bounceRate?: number | null;
  avgDurationMs?: number | null;
  conversions?: number;
}

/** Which optional columns the loaded rows actually carry: the API only
 *  sends the metrics that exist for a dimension, and the table follows. */
type OptionalColumn = "pageviews" | "sessions" | "bounceRate" | "avgDurationMs" | "conversions";
const OPTIONAL_COLUMNS: readonly OptionalColumn[] = [
  "pageviews",
  "sessions",
  "bounceRate",
  "avgDurationMs",
  "conversions",
];
const COLUMN_LABEL_KEYS = {
  pageviews: "analytics.overview.pageviews",
  sessions: "analytics.overview.sessions",
  bounceRate: "analytics.overview.bounce",
  avgDurationMs: "analytics.overview.duration",
  conversions: "analytics.overview.conversions",
} as const;

function presentColumns(rows: readonly Row[]): OptionalColumn[] {
  return OPTIONAL_COLUMNS.filter((col) => rows.some((row) => row[col] !== undefined));
}

function formatCell(row: Row, col: OptionalColumn): string {
  const value = row[col];
  if (value === undefined || value === null) return "–";
  if (col === "bounceRate") return `${Math.round(value * 100)}%`;
  if (col === "avgDurationMs") return formatDurationMs(value);
  return formatCount(value);
}

export function SeeAllDialog({
  target,
  scope,
  win,
  onClose,
  onAddFilter,
}: {
  target: { title: string; dimension: BreakdownDimension } | null;
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onClose: () => void;
  onAddFilter: (dim: FilterDimension, key: string) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        {target ? (
          <SeeAllContent
            key={target.dimension}
            target={target}
            scope={scope}
            win={win}
            onPick={(key) => {
              if (target.dimension !== "goal") onAddFilter(target.dimension, key);
              onClose();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SeeAllContent({
  target,
  scope,
  win,
  onPick,
}: {
  target: { title: string; dimension: BreakdownDimension };
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onPick: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");

  const limit = Math.min(pages * PAGE_SIZE, MAX_LIMIT);
  const query = useBreakdown(scope, win, target.dimension, { limit });
  const rows: Row[] = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const isCountry = target.dimension === "country";
  const labelOf = (key: string) => (isCountry ? countryName(key) : key);

  const needle = search.trim().toLowerCase();
  const visible =
    needle === ""
      ? rows
      : rows.filter(
          (row) =>
            row.key.toLowerCase().includes(needle) ||
            labelOf(row.key).toLowerCase().includes(needle),
        );
  const columns = presentColumns(rows);
  const keyHeader = target.dimension === "goal" ? "event" : target.dimension;

  return (
    <div className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle>{target.title}</DialogTitle>
      </DialogHeader>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("analytics.overview.searchPlaceholder")}
        aria-label={t("analytics.overview.searchPlaceholder")}
        className="h-8"
      />
      <div className="max-h-[60vh] overflow-y-auto rounded-md ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`analytics.filters.dims.${keyHeader}`)}</TableHead>
              <TableHead className="text-right">{t("analytics.overview.visitors")}</TableHead>
              {columns.map((col) => (
                <TableHead key={col} className="text-right">
                  {t(COLUMN_LABEL_KEYS[col])}
                </TableHead>
              ))}
              <TableHead className="text-right">{t("analytics.overview.share")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {t("analytics.overview.noData")}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow
                  key={row.key}
                  onClick={row.key === "(none)" ? undefined : () => onPick(row.key)}
                  className={row.key === "(none)" ? undefined : "cursor-pointer"}
                >
                  <TableCell className="max-w-64 truncate font-mono text-xs" title={row.key}>
                    {labelOf(row.key)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatCount(row.visitors)}
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col} className="text-right font-mono text-xs tabular-nums">
                      {formatCell(row, col)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {formatShare(row.visitors, total)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {query.data?.hasMore && limit < MAX_LIMIT ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetching}
            onClick={() => setPages((p) => p + 1)}
          >
            {t("analytics.overview.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
