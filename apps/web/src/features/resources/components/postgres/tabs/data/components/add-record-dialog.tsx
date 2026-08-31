/**
 * Add-record modal. A typed form generated from the table's structure. Per
 * column: auto (identity/serial) fields are shown read-only as "auto"; booleans
 * get a select (default / true / false / NULL); json a textarea; everything
 * else an input with the column DEFAULT as placeholder. Required = non-nullable
 * with no default. Empty fields are OMITTED from the INSERT so server defaults
 * apply; submission goes through the audited `mutateRow(op: "insert")` path
 * (`database:write`-gated, PK-guarded UI like inline edits) and refetches on
 * success. Pure draft→payload logic lives in ../data/insert (tested).
 */

import type { CellKind } from "@otterdeploy/data-engine";

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
import { useMutateRows, useTableStructure } from "../data/use-database";
import { FieldRow } from "./add-record-fields";

/** A column's issue depends only on its own draft value, so it can be
 *  computed per field without re-validating the whole draft. */
const issueReason = (col: StructureColumn, kind: CellKind, raw: string | undefined) =>
  validateInsertDraft([col], { [col.name]: kind }, { [col.name]: raw })[0]?.reason;

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
  const { query, structure, columns } = useTableStructure({ resourceId, table });
  const mutateRows = useMutateRows(resourceId);
  // Cell kinds by column name: what each draft field is parsed into.
  const kinds: Record<string, CellKind> = {};
  for (const c of columns) kinds[c.name] = c.kind;
  const [showIssues, setShowIssues] = useState(false);

  // Annotated (not cast) so useForm infers the open string-keyed draft shape
  // rather than the empty literal. Same fresh object per render as before.
  const defaultValues: InsertDraft = {};
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      const issues = validateInsertDraft(structure, kinds, value);
      if (issues.length > 0) return setShowIssues(true);
      mutateRows.mutate(
        {
          resourceId,
          mutations: [
            {
              op: "insert",
              schema: table.schema,
              table: table.name,
              pk: [],
              set: buildInsertSet(structure, kinds, value),
            },
          ],
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
      <DialogContent className="flex max-h-[86vh] flex-col gap-0 p-0 [--dlg-pad:0px] sm:max-w-lg">
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
                      cellKind={kinds[col.name] ?? "text"}
                      value={field.state.value ?? ""}
                      onChange={field.handleChange}
                      issue={
                        showIssues
                          ? issueReason(col, kinds[col.name] ?? "text", field.state.value)
                          : undefined
                      }
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
            disabled={mutateRows.isPending || query.isLoading || query.isError}
          >
            {mutateRows.isPending ? "Adding…" : "Add record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
