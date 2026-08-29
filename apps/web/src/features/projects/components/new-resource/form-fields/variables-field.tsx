import { useState } from "react";

import { hasOpenRefToken, insertRefToken } from "@/features/resources/components/_shared/ref-token";
import { issueFor, type EnvSuggestion } from "@/features/resources/env-catalog";
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
  /** The stack/template declares this `${VAR}` with no default: a value must be
   *  set before it can deploy. Drives the required/optional indicator. Absent =
   *  operator-added / optional. */
  required?: boolean;
  /** The address the wizard auto-filled this URL/host-shaped var with (the
   *  stack's resolved public host). When the operator EDITS such a value, the
   *  stage step reads the new hostname back as the exposed service's public
   *  domain, so the URL they typed is the URL the route actually publishes
   *  at. Absent on secrets, defaults, and operator-added rows. */
  seedValue?: string;
}

/**
 * Keys used by more than one row (trimmed; blank rows don't count). Only the
 * LAST duplicate would survive the flatten to a record, so the others would be
 * silently dropped at deploy: the same trap the service variables editor
 * already flags. Shared with the mount sites' field validator so the row
 * warning and the submit block cannot drift.
 */
export function duplicateEnvKeys(vars: Var[]): Set<string> {
  const counts = new Map<string, number>();
  for (const v of vars) {
    const k = v.key.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/** Field validator for the wizard mounts: blocks the deploy while duplicate
 *  keys exist. The per-row warning explains WHICH keys; the error itself is
 *  never rendered. */
export function noDuplicateKeysValidator({ value }: { value: Var[] }): string | undefined {
  return duplicateEnvKeys(value).size > 0 ? "duplicate keys" : undefined;
}

/**
 * The wizard's field validator once a schema is in play: duplicates, plus any
 * row whose value fails a REQUIRED schema check. Warn-level issues render
 * under the row and do not fail the field. Built per mount because the
 * suggestion set is per template; falls back to the duplicate check alone
 * when there are none.
 */
export function variablesValidatorFor(suggestions: ReadonlyArray<EnvSuggestion>) {
  return ({ value }: { value: Var[] }): string | undefined => {
    const dup = noDuplicateKeysValidator({ value });
    if (dup) return dup;
    return value.some((v) => issueFor(suggestions, v.key, v.value)?.level === "block")
      ? "required values missing or malformed"
      : undefined;
  };
}

export function VariablesField({
  projectId,
  suggestions = [],
}: {
  projectId?: string;
  /** Known env vars for the wizard's typed image (env catalog). */
  suggestions?: EnvSuggestion[];
}) {
  const field = useFieldContext<Var[]>();
  const vars = field.state.value;
  const duplicateKeys = duplicateEnvKeys(vars);
  const [bulk, setBulk] = useState(false);
  // Which row's reference picker is open. Opened by typing `${{` (autocomplete)
  // or clicking the `{ }` button in a value cell.
  const [pickerRow, setPickerRow] = useState<number | null>(null);

  const setValue = (i: number, value: string) => {
    field.handleChange(vars.map((x, j) => (j === i ? { ...x, value } : x)));
  };

  // Reads the CURRENT field value instead of the render-scoped `vars`: the
  // key combobox fires onInputValueChange and onValueChange in the same tick
  // on a pick, and two writes built from the same stale array would clobber
  // each other (the second one dropped the first's secret flag).
  const patchRow = (i: number, patch: (row: Var) => Partial<Var>) => {
    const current = field.state.value;
    field.handleChange(current.map((x, j) => (j === i ? { ...x, ...patch(x) } : x)));
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
              duplicate={duplicateKeys.has(v.key.trim())}
              issue={issueFor(suggestions, v.key, v.value)}
              projectId={projectId}
              suggestions={suggestions}
              takenKeys={
                new Set(
                  vars
                    .filter((_, j) => j !== i)
                    .map((x) => x.key.trim())
                    .filter(Boolean),
                )
              }
              pickerOpen={pickerRow === i}
              onKeyChange={(key) => patchRow(i, () => ({ key }))}
              onSuggestionPick={(s) =>
                patchRow(i, (x) => ({
                  key: s.key,
                  value:
                    x.value.trim() === "" && s.defaultValue !== undefined
                      ? s.defaultValue
                      : x.value,
                  secret: s.secret ? true : x.secret,
                }))
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
