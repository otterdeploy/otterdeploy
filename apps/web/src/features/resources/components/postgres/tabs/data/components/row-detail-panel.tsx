/**
 * Row detail — a right-hand panel showing every column of one row as labeled
 * read-only values with per-field copy. PK fields are highlighted; "Edit" jumps
 * to the grid's inline cell editor when the studio is editable. Opened from the
 * grid's per-row detail button; lives inside the grid wrapper so it can reach
 * the grid's imperative cell-editing handles.
 */

import { useState } from "react";

import {
  Cancel01Icon,
  Copy01Icon,
  Key01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import { TypeLabel } from "./type-label";

export function RowDetailPanel({
  columns,
  row,
  columnTypes,
  primaryKey,
  editable,
  onEditField,
  onClose,
}: {
  columns: string[];
  row: Record<string, string | null>;
  columnTypes?: Record<string, string>;
  primaryKey?: string[];
  editable: boolean;
  /** Jump to the grid's inline editor for this column. */
  onEditField?: (column: string) => void;
  onClose: () => void;
}) {
  const pk = new Set(primaryKey ?? []);
  const rowId = primaryKey?.length ? (row[primaryKey[0] ?? ""] ?? null) : null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-[12px] font-medium">Row detail</span>
        {rowId !== null ? (
          <span
            className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            title={rowId}
          >
            {rowId}
          </span>
        ) : null}
        <div className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Close row detail" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {columns.map((c) => (
            <FieldValue
              key={c}
              name={c}
              value={row[c] ?? null}
              type={columnTypes?.[c]}
              isPk={pk.has(c)}
              editable={editable && !pk.has(c)}
              onEdit={onEditField ? () => onEditField(c) : undefined}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

function FieldValue({
  name,
  value,
  type,
  isPk,
  editable,
  onEdit,
}: {
  name: string;
  value: string | null;
  type?: string;
  isPk: boolean;
  editable: boolean;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="group flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className={cn("font-mono font-medium", isPk && "text-amber-600 dark:text-amber-500")}>
          {name}
        </span>
        {type ? <TypeLabel type={type} /> : null}
        {isPk ? (
          <HugeiconsIcon
            icon={Key01Icon}
            strokeWidth={2}
            className="size-2.5 text-amber-600 dark:text-amber-500"
          />
        ) : null}
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {editable && onEdit ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-5"
                    aria-label={`Edit ${name}`}
                    onClick={onEdit}
                  />
                }
              >
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-3" />
              </TooltipTrigger>
              <TooltipContent>Edit in grid</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-5"
                  aria-label={`Copy ${name}`}
                  onClick={() => void copy()}
                />
              }
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
                className="size-3"
              />
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copied" : "Copy value"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        className={cn(
          "rounded-md px-2 py-1 font-mono text-[11.5px] break-all whitespace-pre-wrap ring-1 ring-foreground/10",
          isPk ? "bg-amber-500/5" : "bg-muted/40",
          value === null && "text-muted-foreground/60 italic",
        )}
      >
        {value === null ? "NULL" : value === "" ? " " : value}
      </div>
    </div>
  );
}
