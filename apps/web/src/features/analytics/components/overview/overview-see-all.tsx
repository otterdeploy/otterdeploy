/**
 * The Overview's binding of the See-all dialog: offset paging over
 * `analytics.breakdown`, the per-dimension extra columns (the API only sends
 * the metrics that exist for a dimension, and the table follows), and a row
 * pick that writes a real filter into the URL.
 */

import type { BreakdownDimension, FilterDimension } from "@otterdeploy/shared/analytics-filters";

import { useState } from "react";

import { useTranslation } from "react-i18next";

import { countryName, formatCount } from "../../analytics-model";
import {
  type AnalyticsScope,
  type AnalyticsWindowState,
  useBreakdown,
} from "../../hooks/use-web-analytics";
import { formatDurationMs } from "../../lib/format-duration";
import { isMonoDimension, leadingFor } from "./dimension-leading";
import { SeeAllDialog, type SeeAllColumn } from "./see-all-dialog";

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
  conversionRate?: number;
}

type OptionalColumn = Exclude<keyof Row, "key" | "visitors">;

const OPTIONAL_COLUMNS: readonly OptionalColumn[] = [
  "pageviews",
  "sessions",
  "bounceRate",
  "avgDurationMs",
  "conversions",
  "conversionRate",
];

const COLUMN_LABEL_KEYS = {
  pageviews: "analytics.overview.pageviews",
  sessions: "analytics.overview.sessions",
  bounceRate: "analytics.overview.bounce",
  avgDurationMs: "analytics.overview.avgVisit",
  conversions: "analytics.overview.conversions",
  conversionRate: "analytics.overview.rate",
} as const satisfies Record<OptionalColumn, string>;

function formatCell(row: Row, col: OptionalColumn): string {
  const value = row[col];
  if (value === undefined || value === null) return "–";
  if (col === "bounceRate" || col === "conversionRate") return `${Math.round(value * 100)}%`;
  if (col === "avgDurationMs") return formatDurationMs(value);
  return formatCount(value);
}

export interface SeeAllTarget {
  title: string;
  dimension: BreakdownDimension;
}

export function OverviewSeeAll({
  target,
  scope,
  win,
  onClose,
  onAddFilter,
}: {
  target: SeeAllTarget | null;
  scope: AnalyticsScope;
  win: AnalyticsWindowState;
  onClose: () => void;
  onAddFilter: (dim: FilterDimension, key: string) => void;
}) {
  const { t } = useTranslation();
  const [pages, setPages] = useState(1);
  // A closed dialog keeps the last dimension so the query stays warm across
  // a quick close-and-reopen; the page count resets with the target.
  const dimension = target?.dimension ?? "path";
  const limit = Math.min(pages * PAGE_SIZE, MAX_LIMIT);
  const query = useBreakdown(scope, win, dimension, { limit, enabled: target !== null });

  const rows: Row[] = query.data?.rows ?? [];
  const columns: SeeAllColumn<Row>[] = OPTIONAL_COLUMNS.filter((col) =>
    rows.some((row) => row[col] !== undefined),
  ).map((col) => ({
    id: col,
    label: t(COLUMN_LABEL_KEYS[col]),
    cell: (row) => formatCell(row, col),
  }));

  const keyHeader = dimension === "goal" ? "event" : dimension;

  return (
    <SeeAllDialog
      open={target !== null}
      onClose={() => {
        setPages(1);
        onClose();
      }}
      title={target?.title ?? ""}
      dimensionLabel={t(`analytics.filters.dims.${keyHeader}`)}
      total={query.data?.total ?? 0}
      unitLabel={t("analytics.overview.inRange")}
      rows={rows}
      loading={query.isPending}
      valueLabel={t("analytics.overview.visitors")}
      valueOf={(row) => row.visitors}
      columns={columns}
      displayKey={dimension === "country" ? countryName : undefined}
      renderLeading={leadingFor(dimension)}
      mono={isMonoDimension(dimension)}
      onPick={
        dimension === "goal"
          ? undefined
          : (key) => {
              onAddFilter(dimension, key);
            }
      }
      hasMore={Boolean(query.data?.hasMore) && limit < MAX_LIMIT}
      onLoadMore={() => setPages((p) => p + 1)}
      loadingMore={query.isFetching}
    />
  );
}
