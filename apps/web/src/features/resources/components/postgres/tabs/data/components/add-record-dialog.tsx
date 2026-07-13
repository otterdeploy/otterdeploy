/**
 * Add-record modal — a typed form generated from the table's structure. Per
 * column: auto (identity/serial) fields are shown read-only as "auto"; booleans
 * get a select (default / true / false / NULL); json a textarea; everything
 * else an input with the column DEFAULT as placeholder. Required = non-nullable
 * with no default. Empty fields are OMITTED from the INSERT so server defaults
 * apply; submission goes through the audited `mutateRow(op: "insert")` path
 * (`database:write`-gated, PK-guarded UI like inline edits) and refetches on
 * success. Pure draft→payload logic lives in ../data/insert (tested).
 */

import { useState } from "react";

import { Key01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";

import type { InsertDraft } from "../data/insert";
import type { TableRef } from "../data/queries";
import type { StructureColumn } from "../data/structure";

import { buildInsertSet, NULL_SENTINEL, validateInsertDraft } from "../data/insert";
import { columnInputKind } from "../data/structure";
import { useMutateRow, useTableStructure } from "../data/use-database";
import { TypeLabel } from "./type-label";

/** A column's issue depends only on its own draft value, so it can be
 *  computed per field without re-validating the whole draft. */
const issueReason = (col: StructureColumn, raw: string | undefined) =>
  validateInsertDraft([col], { [col.name]: raw })[0]?.reason;

export function AddRecordDialog({
  resourceId,
  table,
  open,
  onOpenChange,
  onInserted,
}: {
  resourceId: string;
  table: TableRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful insert (refetch rows / counts). */
  onInserted: () => void;
}) {
  const { query, structure } = useTableStructure({ resourceId, table, enabled: open });
  const mutateRow = useMutateRow();
  const [showIssues, setShowIssues] = useState(false);

  const form = useForm({
    defaultValues: {} as InsertDraft,
    onSubmit: ({ value }) => {
      const issues = validateInsertDraft(structure, value);
      if (issues.length > 0) return setShowIssues(true);
      mutateRow.mutate(
        {
          resourceId,
          schema: table.schema,
          table: table.name,
          op: "insert",
          pk: [],
          set: buildInsertSet(structure, value),
        },
        {
          onSuccess: () => {
            toast.success(`Row added to ${table.name}`);
            close(false);
            onInserted();
          },
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : "Couldn't insert the row."),
        },
      );
    },
  });

  const close = (next: boolean) => {
    if (!next) {
      form.reset();
      setShowIssues(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            Add record
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {table.schema === "public" ? table.name : `${table.schema}.${table.name}`}
            </span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3.5 p-4">
            {query.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted/60" />
              ))
            ) : query.isError ? (
              <p className="text-[12px] text-muted-foreground">
                Couldn&apos;t introspect the table&apos;s columns.
              </p>
            ) : (
              structure.map((col) => (
                <form.Field key={col.name} name={col.name}>
                  {(field) => (
                    <FieldRow
                      col={col}
                      value={field.state.value ?? ""}
                      onChange={field.handleChange}
                      issue={showIssues ? issueReason(col, field.state.value) : undefined}
                    />
                  )}
                </form.Field>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Popup is p-0 here, so cancel the footer's full-bleed -mx-4/-mb-4 offsets. */}
        <DialogFooter className="mx-0 mb-0 border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void form.handleSubmit()}
            disabled={mutateRow.isPending || query.isLoading || query.isError}
          >
            {mutateRow.isPending ? "Adding…" : "Add record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ISSUE_TEXT: Record<string, string> = {
  required: "Required — the column is NOT NULL with no default.",
  "invalid-json": "Not valid JSON.",
  "invalid-number": "Not a number.",
};

function FieldRow({
  col,
  value,
  onChange,
  issue,
}: {
  col: StructureColumn;
  value: string;
  onChange: (v: string) => void;
  issue?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-mono font-medium">{col.name}</span>
        <TypeLabel type={col.displayType} />
        {col.isPrimaryKey ? (
          <HugeiconsIcon
            icon={Key01Icon}
            strokeWidth={2}
            className="size-2.5 text-amber-600 dark:text-amber-500"
          />
        ) : null}
        {col.fkRef ? (
          <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
            <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-2.5" />
            {col.fkRef.table}.{col.fkRef.column}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {col.isAuto ? "auto" : col.isRequired ? "required" : col.nullable ? "nullable" : ""}
        </span>
      </div>

      <FieldControl col={col} value={value} onChange={onChange} />

      {issue ? (
        <span className="text-[11px] text-destructive">{ISSUE_TEXT[issue] ?? issue}</span>
      ) : null}
    </div>
  );
}

function FieldControl({
  col,
  value,
  onChange,
}: {
  col: StructureColumn;
  value: string;
  onChange: (v: string) => void;
}) {
  // Identity / serial — the database generates the value.
  if (col.isAuto) {
    return (
      <div className="rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground/70 ring-1 ring-foreground/10">
        auto-generated
      </div>
    );
  }

  const kind = columnInputKind(col.dataType);
  const placeholder =
    col.default !== null ? `default: ${col.default}` : col.nullable ? "NULL" : col.displayType;

  if (kind === "boolean") {
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger size="sm" className="w-full font-mono text-[12px]">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true" className="font-mono text-[12px]">
            true
          </SelectItem>
          <SelectItem value="false" className="font-mono text-[12px]">
            false
          </SelectItem>
          {col.nullable ? (
            <SelectItem value={NULL_SENTINEL} className="font-mono text-[12px]">
              NULL
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    );
  }

  if (kind === "json") {
    return (
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={col.default !== null ? `default: ${col.default}` : '{ "key": "value" }'}
        rows={3}
        className="resize-y font-mono text-[12px]"
        spellCheck={false}
      />
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        kind === "timestamp" && col.default === null ? "2026-01-01 12:00:00" : placeholder
      }
      inputMode={kind === "number" ? "decimal" : undefined}
      className="h-8 font-mono text-[12px]"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
