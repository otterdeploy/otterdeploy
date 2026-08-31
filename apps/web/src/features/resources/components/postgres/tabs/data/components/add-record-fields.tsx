/**
 * The per-column form controls for {@link AddRecordDialog}.
 *
 * Split out for size, and because the control a column gets is now decided by
 * its introspected cell KIND rather than by a regex over its type name — which
 * is a different concern from the dialog's submit/validate lifecycle.
 */
import type { CellKind } from "@otterdeploy/data-engine";

import { Key01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";

import type { StructureColumn } from "../data/structure";

import { NULL_SENTINEL } from "../data/insert";
import { columnInputKind } from "../data/structure";
import { TypeLabel } from "./type-label";

const ISSUE_TEXT: Record<string, string> = {
  required: "Required. The column is NOT NULL with no default.",
  "invalid-json": "Not valid JSON.",
  "invalid-number": "Not a number.",
};

export function FieldRow({
  col,
  cellKind,
  value,
  onChange,
  issue,
}: {
  col: StructureColumn;
  /** The column's introspected family — what its input is chosen from. */
  cellKind: CellKind;
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

      <FieldControl col={col} cellKind={cellKind} value={value} onChange={onChange} />

      {issue ? (
        <span className="text-[11px] text-destructive">{ISSUE_TEXT[issue] ?? issue}</span>
      ) : null}
    </div>
  );
}

function FieldControl({
  col,
  cellKind,
  value,
  onChange,
}: {
  col: StructureColumn;
  cellKind: CellKind;
  value: string;
  onChange: (v: string) => void;
}) {
  // Identity / serial: the database generates the value.
  if (col.isAuto) {
    return (
      <div className="rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground/70 ring-1 ring-foreground/10">
        auto-generated
      </div>
    );
  }

  const kind = columnInputKind(col, cellKind);
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
      placeholder={kind === "date" && col.default === null ? "2026-01-01 12:00:00" : placeholder}
      inputMode={kind === "number" ? "decimal" : undefined}
      className="h-8 font-mono text-[12px]"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
