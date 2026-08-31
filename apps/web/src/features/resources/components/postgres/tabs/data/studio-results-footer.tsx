/**
 * Footer + bulk-delete confirmation for {@link StudioResults}: row count /
 * duration / selection actions on the left, table-mode pagination on the
 * right, and the typed-confirm dialog that gates bulk deletes.
 */

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import { SQL_RESULT_CAP } from "./data/queries";
import { type DataStudioController, PAGE_SIZES } from "./use-data-studio";

/** Rows above this get the type-the-table-name gate instead of a plain confirm. */
const TYPED_CONFIRM_THRESHOLD = 10;

/** Bulk-delete confirm, typed table name past the threshold. */
export function BulkDeleteConfirm({
  pending,
  tableName,
  onCancel,
  onConfirm,
}: {
  /** Row indices awaiting confirmation (null = dialog closed). */
  pending: number[] | null;
  tableName: string | undefined;
  onCancel: () => void;
  onConfirm: (indices: number[]) => void;
}) {
  const count = pending?.length ?? 0;
  return (
    <TypedConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Delete ${count} row${count === 1 ? "" : "s"}?`}
      description={
        <>
          Each row is deleted by primary key from <span className="font-mono">{tableName}</span>.
          This can&apos;t be undone.
        </>
      }
      confirmPhrase={count > TYPED_CONFIRM_THRESHOLD ? tableName : undefined}
      confirmLabel="Delete rows"
      onConfirm={() => onConfirm(pending ?? [])}
    />
  );
}

export function ResultsFooter({
  studio,
  selectedRows,
  deleteProgress,
  canDelete,
  onDeleteSelected,
}: {
  studio: DataStudioController;
  selectedRows: number[];
  deleteProgress: { done: number; total: number } | null;
  /** Deleting needs write; SELECTING never did. */
  canDelete: boolean;
  onDeleteSelected: () => void;
}) {
  const t = studio.table;
  const result = t.result;
  if (!result) return null;
  const selectedCount = selectedRows.length;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2 font-mono">
        {/* What you are looking at, named, before how much of it there is.
            The qualified name is the one fact a screenshot of this grid is
            useless without. */}
        {t.mode === "table" && t.selected ? (
          <>
            <span className="text-foreground">
              {t.selected.schema === "public"
                ? t.selected.name
                : `${t.selected.schema}.${t.selected.name}`}
            </span>
            <span className="text-muted-foreground/40">·</span>
          </>
        ) : null}
        <span>{result.rows.length} rows</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{result.durationMs}ms</span>
        {t.mode === "sql" && result.truncated ? (
          <span className="text-amber-500">· capped at {SQL_RESULT_CAP}</span>
        ) : null}
        {deleteProgress ? (
          <span className="text-foreground">
            · deleting {deleteProgress.done}/{deleteProgress.total}…
          </span>
        ) : selectedCount > 0 ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-foreground">{selectedCount} selected</span>
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[11px] text-destructive hover:text-destructive"
                onClick={onDeleteSelected}
              >
                Delete selected
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {t.mode === "table" ? (
        <div className="flex items-center gap-2">
          {/* Whether this connection can write, stated rather than discovered
              by an edit being refused. */}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
            {t.editable ? "read-write" : "read-only"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-mono">
            {result.rows.length === 0
              ? "0"
              : `${t.page * t.pageSize + 1}–${t.page * t.pageSize + result.rows.length}`}
          </span>
          <Select
            value={String(t.pageSize)}
            onValueChange={(v) => {
              t.setPageSize(Number(v));
              t.setPage(0);
            }}
          >
            <SelectTrigger className="h-6 w-19 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}/page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={t.page === 0}
            onClick={() => t.setPage((prev) => Math.max(0, prev - 1))}
            aria-label="Previous page"
          >
            ‹
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!t.hasNext}
            onClick={() => t.setPage((prev) => prev + 1)}
            aria-label="Next page"
          >
            ›
          </Button>
        </div>
      ) : null}
    </div>
  );
}
