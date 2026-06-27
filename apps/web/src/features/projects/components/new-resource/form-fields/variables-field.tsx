import { Fragment, useState } from "react";

import { ReferencePicker } from "@/features/projects/components/variables";
import { hasOpenRefToken, insertRefToken } from "@/features/resources/components/_shared/ref-token";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

import { useFieldContext } from "../form-context";
import { I } from "../icons";

export interface Var {
  key: string;
  value: string;
  secret: boolean;
}

// Keys that look like credentials get the secret lock on by default.
const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING)/i;

/** Parse a dotenv block into rows. Ignores blanks/comments, strips quotes. */
function parseEnvText(text: string): Var[] {
  const out: Var[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.replace(/^export\s+/, "");
    const eq = stripped.indexOf("=");
    if (eq === -1) continue;
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = stripped
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    out.push({ key, value, secret: SECRETISH.test(key) });
  }
  return out;
}

function serializeEnv(vars: Var[]): string {
  return vars.map((v) => `${v.key}=${v.value}`).join("\n");
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
            <TableHead className="w-[60px] text-center text-[11px] font-semibold tracking-[0.06em] uppercase">
              Secret
            </TableHead>
            <TableHead className="w-9" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {vars.map((v, i) => (
            <Fragment key={i}>
              <TableRow>
                <TableCell className="py-2">
                  <Input
                    type="text"
                    value={v.key}
                    placeholder="KEY"
                    onChange={(e) => {
                      const next = vars.map((x, j) =>
                        j === i ? { ...x, key: e.target.value } : x,
                      );
                      field.handleChange(next);
                    }}
                    className="h-8 font-mono"
                  />
                </TableCell>
                <TableCell className="py-2">
                  <div className="relative">
                    <Input
                      type={v.secret ? "password" : "text"}
                      value={v.value}
                      placeholder={v.secret ? "••••••••" : "value"}
                      onChange={(e) => {
                        const val = e.target.value;
                        setValue(i, val);
                        // Autocomplete: an unclosed `${{` opens the picker; a
                        // completed/removed token closes it again.
                        if (projectId && hasOpenRefToken(val)) setPickerRow(i);
                        else if (pickerRow === i) setPickerRow(null);
                      }}
                      className="h-8 pr-8 font-mono"
                    />
                    {projectId && (
                      <button
                        type="button"
                        aria-label="Insert reference"
                        title="Insert a ${{ resource.KEY }} reference"
                        onClick={() => setPickerRow((cur) => (cur === i ? null : i))}
                        className={cn(
                          "absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded transition-colors",
                          pickerRow === i
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className="font-mono text-[10.5px] leading-none">{"{ }"}</span>
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-2 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={v.secret ? "Mark as plain" : "Mark as secret"}
                    onClick={() => {
                      const next = vars.map((x, j) => (j === i ? { ...x, secret: !x.secret } : x));
                      field.handleChange(next);
                    }}
                    className={v.secret ? "text-foreground" : "text-muted-foreground"}
                  >
                    <I.lock width={12} height={12} />
                  </Button>
                </TableCell>
                <TableCell className="py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      field.handleChange(vars.filter((_, j) => j !== i));
                      if (pickerRow === i) setPickerRow(null);
                    }}
                  >
                    <I.x width={11} height={11} />
                  </Button>
                </TableCell>
              </TableRow>
              {projectId && pickerRow === i && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-0 pb-2">
                    <ReferencePicker
                      projectId={projectId}
                      onPick={(token) => {
                        setValue(i, insertRefToken(v.value, token));
                        setPickerRow(null);
                      }}
                      onClose={() => setPickerRow(null)}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
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

/** Empty state: a dashed dropzone that accepts a dragged .env file or opens
 *  the bulk editor. */
function EmptyDropzone({
  onAddVariable,
  onOpenBulk,
  onImport,
}: {
  onAddVariable: () => void;
  onOpenBulk: () => void;
  onImport: (text: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        const text = file ? await file.text() : e.dataTransfer.getData("text");
        if (text) onImport(text);
      }}
      className={cn(
        "mt-2.5 flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-12 text-center transition-colors",
        dragOver ? "border-ring bg-muted/40" : "border-border/60 bg-muted/10",
      )}
    >
      <I.upload width={18} height={18} className="text-muted-foreground" />
      <p className="text-[13px] text-muted-foreground">
        Add a single variable, or paste/drag a <span className="font-mono">.env</span> block.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAddVariable}>
          <I.plus width={11} height={11} />
          Add variable
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenBulk}>
          <I.copy width={11} height={11} />
          Open bulk edit
        </Button>
      </div>
    </div>
  );
}

/** Textarea bulk editor — paste a whole .env block, parsed on Apply. */
function BulkEditor({
  initial,
  onApply,
  onCancel,
}: {
  initial: string;
  onApply: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);

  return (
    <Card className="mt-2.5 flex flex-col gap-3 p-3.5">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        autoFocus
        spellCheck={false}
        className="font-mono text-[12.5px]"
        placeholder={"KEY=value\nANOTHER_KEY=value\n# comments and blank lines are ignored"}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          One <span className="font-mono">KEY=value</span> per line. Replaces the current set.
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => onApply(text)}>
            Apply
          </Button>
        </div>
      </div>
    </Card>
  );
}
