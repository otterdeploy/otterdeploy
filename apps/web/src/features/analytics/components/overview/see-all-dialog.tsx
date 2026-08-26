/**
 * "See all" drill-in for a breakdown card: the full ranked table with a
 * client-side filter over what's loaded and a Load-more footer. Rows are the
 * same affordance as card rows — click to narrow the page — so the dialog is
 * a bigger lens, not a different tool.
 *
 * Data-agnostic on purpose: rows and column config come in, picks go out, so
 * the tracker plane (Overview) and the edge plane (Traffic) share one dialog
 * instead of two tables that drift apart.
 */

import type { ReactNode } from "react";
import { useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/components/ui/input-group";

import { formatCount } from "../../analytics-model";
import { SeeAllTable, type SeeAllColumn, type SeeAllRowBase } from "./see-all-table";

export type { SeeAllColumn, SeeAllRowBase } from "./see-all-table";

export interface SeeAllDialogProps<Row extends SeeAllRowBase> {
  open: boolean;
  onClose: () => void;
  /** The card's title. */
  title: string;
  /** "Country", "Browser": names the key column and the summary line. */
  dimensionLabel: string;
  /** Denominator for the share column. */
  total: number;
  /** "visitors in range" / "requests in range". */
  unitLabel: string;
  rows: readonly Row[];
  loading: boolean;
  /** Header of the primary numeric column (Visitors / Requests). */
  valueLabel: string;
  valueOf: (row: Row) => number;
  /** Extra numeric columns the rows carry, between the value and the share. */
  columns?: readonly SeeAllColumn<Row>[];
  displayKey?: (key: string) => string;
  renderLeading?: (key: string) => ReactNode;
  mono?: boolean;
  /** Row click; omitted ⇒ rows are read-only. Closes the dialog after. */
  onPick?: (key: string) => void;
  selectedKey?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function SeeAllDialog<Row extends SeeAllRowBase>(props: SeeAllDialogProps<Row>) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="sm:max-w-2xl">
        {/* Keyed on the title so the search resets when a different card
            opens the dialog, without a sync effect. */}
        <SeeAllContent key={props.title} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function SeeAllContent<Row extends SeeAllRowBase>({
  onClose,
  title,
  dimensionLabel,
  total,
  unitLabel,
  rows,
  loading,
  valueLabel,
  valueOf,
  columns = [],
  displayKey,
  renderLeading,
  mono = true,
  onPick,
  selectedKey,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}: SeeAllDialogProps<Row>) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const labelOf = (key: string) => (displayKey ? displayKey(key) : key);
  const needle = search.trim().toLowerCase();
  const visible =
    needle === ""
      ? rows
      : rows.filter(
          (row) =>
            row.key.toLowerCase().includes(needle) ||
            labelOf(row.key).toLowerCase().includes(needle),
        );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-xs">
          {dimensionLabel}
          <span aria-hidden="true"> · </span>
          <span className="font-mono tabular-nums">{formatCount(total)}</span> {unitLabel}
        </DialogDescription>
      </DialogHeader>

      <InputGroup className="h-8">
        <InputGroupAddon>
          <HugeiconsIcon icon={Search01Icon} strokeWidth={1.5} className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("analytics.overview.searchPlaceholder")}
          aria-label={t("analytics.overview.searchPlaceholder")}
          className="h-8 text-sm"
        />
      </InputGroup>

      <SeeAllTable
        rows={visible}
        total={total}
        loading={loading}
        keyLabel={dimensionLabel}
        valueLabel={valueLabel}
        valueOf={valueOf}
        columns={columns}
        displayKey={labelOf}
        renderLeading={renderLeading}
        mono={mono}
        selectedKey={selectedKey}
        onPick={
          onPick
            ? (key) => {
                onPick(key);
                onClose();
              }
            : undefined
        }
      />

      <div className="flex min-h-7 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {t("analytics.overview.showing", { shown: visible.length, loaded: rows.length })}
        </span>
        {hasMore && onLoadMore ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {t("analytics.overview.loadMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
