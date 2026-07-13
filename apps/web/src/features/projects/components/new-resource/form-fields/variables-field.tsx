import { useState } from "react";

import { hasOpenRefToken, insertRefToken } from "@/features/resources/components/_shared/ref-token";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

import { useFieldContext } from "../form-hook-contexts";
import { I } from "../icons";
import {
  BulkEditor,
  EmptyDropzone,
  parseEnvText,
  serializeEnv,
  VariableRow,
} from "./variables-field-parts";

export interface Var {
  key: string;
  value: string;
  secret: boolean;
  /** The stack/template declares this `${VAR}` with no default — a value must be
   *  set before it can deploy. Drives the required/optional indicator. Absent =
   *  operator-added / optional. */
  required?: boolean;
}

export function VariablesField({ projectId }: { projectId?: string }) {
  const field = useFieldContext<Var[]>();
  const vars = field.state.value;
  const [bulk, setBulk] = useState(false);
  // Which row's reference picker is open. Opened by typing `${{` (autocomplete)
  // or clicking the `{ }` button in a value cell.
  const [pickerRow, setPickerRow] = useState<number | null>(null);

  const setValue = (i: number, value: string) => {
    field.handleChange(vars.map((x, j) => (j === i ? { ...x, value } : x)));
  };

  if (bulk) {
    return (
      <BulkEditor
        initial={serializeEnv(vars)}
        onCancel={() => setBulk(false)}
        onApply={(text) => {
          field.handleChange(parseEnvText(text));
          setBulk(false);
        }}
      />
    );
  }

  if (vars.length === 0) {
    return (
      <EmptyDropzone
        onAddVariable={() => field.handleChange([{ key: "", value: "", secret: false }])}
        onOpenBulk={() => setBulk(true)}
        onImport={(text) => {
          const parsed = parseEnvText(text);
          if (parsed.length > 0) field.handleChange(parsed);
        }}
      />
    );
  }

  return (
    <Card className="mt-2.5 gap-0 overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="text-[11px] font-semibold tracking-[0.06em] uppercase">
              Key
            </TableHead>
            <TableHead className="text-[11px] font-semibold tracking-[0.06em] uppercase">
              Value
            </TableHead>
            <TableHead className="w-[44px]" />
            <TableHead className="w-[60px] text-center text-[11px] font-semibold tracking-[0.06em] uppercase">
              Secret
            </TableHead>
            <TableHead className="w-9" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {vars.map((v, i) => (
            <VariableRow
              key={i}
              v={v}
              projectId={projectId}
              pickerOpen={pickerRow === i}
              onKeyChange={(key) =>
                field.handleChange(vars.map((x, j) => (j === i ? { ...x, key } : x)))
              }
              onValueInput={(val) => {
                setValue(i, val);
                // Autocomplete: an unclosed `${{` opens the picker; a
                // completed/removed token closes it again.
                if (projectId && hasOpenRefToken(val)) setPickerRow(i);
                else if (pickerRow === i) setPickerRow(null);
              }}
              onTogglePicker={() => setPickerRow((cur) => (cur === i ? null : i))}
              onToggleSecret={() =>
                field.handleChange(vars.map((x, j) => (j === i ? { ...x, secret: !x.secret } : x)))
              }
              onRemove={() => {
                field.handleChange(vars.filter((_, j) => j !== i));
                if (pickerRow === i) setPickerRow(null);
              }}
              onPick={(token) => {
                setValue(i, insertRefToken(v.value, token));
                setPickerRow(null);
              }}
              onClosePicker={() => setPickerRow(null)}
            />
          ))}
        </TableBody>
      </Table>

      {/* Add row + bulk import */}
      <div className="flex items-center gap-2 border-t bg-muted/50 px-3.5 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            field.handleChange([...vars, { key: "", value: "", secret: false }]);
          }}
        >
          <I.plus width={11} height={11} />
          Add variable
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setBulk(true)}>
          <I.copy width={11} height={11} />
          Bulk edit
        </Button>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">
          {vars.length} {vars.length === 1 ? "key" : "keys"}
        </span>
      </div>
    </Card>
  );
}
