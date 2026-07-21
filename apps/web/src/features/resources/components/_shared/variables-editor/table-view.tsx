import { useState } from "react";

import { ArrowReloadHorizontalIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { DraftRow, RowStatus } from "./use-editor-state";

import { EditorRow } from "./editor-row";

interface TableViewProps {
  rows: DraftRow[];
  deletedRows: DraftRow[];
  projectId: string;
  statusOf: (row: DraftRow) => RowStatus;
  onUpdate: (id: string, patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onAddRow: () => void;
}

export function TableView({
  rows,
  deletedRows,
  projectId,
  statusOf,
  onUpdate,
  onDelete,
  onRestore,
  onAddRow,
}: TableViewProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyValue = (id: string, value: string) => {
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 1400);
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border/40">
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          No variables yet. Add one or paste a .env file.
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <EditorRow
              key={row.id}
              row={row}
              status={statusOf(row)}
              projectId={projectId}
              revealed={revealed.has(row.id)}
              copied={copiedId === row.id}
              pickerOpen={pickerOpen === row.id}
              onChange={(patch) => onUpdate(row.id, patch)}
              // Idempotent by target state — the popover's own outside-click /
              // Escape close and an explicit close-on-pick can both land in one
              // tick; a plain toggle would reopen on the second call.
              onPickerOpenChange={(open) => setPickerOpen(open ? row.id : null)}
              onToggleReveal={() => toggleReveal(row.id)}
              onCopy={() => copyValue(row.id, row.value)}
              onDelete={() => onDelete(row.id)}
            />
          ))}
        </div>
      )}

      {deletedRows.length > 0 && (
        <div className="border-t border-border/40 bg-destructive/5 px-3 py-2 text-[11.5px]">
          <div className="mb-1 font-medium text-destructive/90">
            {deletedRows.length} row{deletedRows.length === 1 ? "" : "s"} pending delete
          </div>
          <ul className="flex flex-col gap-1">
            {deletedRows.map((row) => (
              <li key={row.id} className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">{row.key}</span>
                <button
                  type="button"
                  onClick={() => onRestore(row.id)}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <HugeiconsIcon
                    icon={ArrowReloadHorizontalIcon}
                    strokeWidth={2}
                    className="size-3"
                  />
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-border/40 bg-muted/20 px-3 py-2">
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[12px]" onClick={onAddRow}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Add row
        </Button>
      </div>
    </div>
  );
}
