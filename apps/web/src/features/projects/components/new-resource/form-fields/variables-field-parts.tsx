/**
 * Row component, dotenv helpers, empty-state dropzone and bulk editor for
 * the VariablesField. Split out of variables-field.tsx to keep that file +
 * its main component under the line caps.
 */

import { Fragment, useState } from "react";

import { AlertDiamondIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ReferencePicker } from "@/features/projects/components/variables";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

import type { Var } from "./variables-field";

import { I } from "../icons";

// Keys that look like credentials get the secret lock on by default.
const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING)/i;

/** Parse a dotenv block into rows. Ignores blanks/comments, strips quotes. */
export function parseEnvText(text: string): Var[] {
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

export function serializeEnv(vars: Var[]): string {
  return vars.map((v) => `${v.key}=${v.value}`).join("\n");
}

interface VariableRowProps {
  v: Var;
  projectId?: string;
  pickerOpen: boolean;
  onKeyChange: (key: string) => void;
  onValueInput: (value: string) => void;
  onTogglePicker: () => void;
  onToggleSecret: () => void;
  onRemove: () => void;
  onPick: (token: string) => void;
  onClosePicker: () => void;
}

export function VariableRow({
  v,
  projectId,
  pickerOpen,
  onKeyChange,
  onValueInput,
  onTogglePicker,
  onToggleSecret,
  onRemove,
  onPick,
  onClosePicker,
}: VariableRowProps) {
  // Reveal a masked secret so the operator can read the auto-generated value
  // (and copy it). Per-row, defaults to hidden.
  const [reveal, setReveal] = useState(false);
  const masked = v.secret && !reveal;
  // How many trailing buttons sit in the value cell → how much right padding
  // the input needs so the text doesn't run under them.
  const trailingButtons = (v.secret ? 1 : 0) + (projectId ? 1 : 0);

  return (
    <Fragment>
      <TableRow>
        <TableCell className="py-2">
          <Input
            type="text"
            value={v.key}
            placeholder="KEY"
            onChange={(e) => onKeyChange(e.target.value)}
            className="h-8 font-mono"
          />
        </TableCell>
        <TableCell className="py-2">
          <div className="relative">
            <Input
              type={masked ? "password" : "text"}
              value={v.value}
              placeholder={v.secret ? "••••••••" : "value"}
              onChange={(e) => onValueInput(e.target.value)}
              className={cn(
                "h-8 font-mono",
                trailingButtons >= 2 ? "pr-14" : trailingButtons === 1 ? "pr-8" : "",
              )}
            />
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
              {v.secret && (
                <button
                  type="button"
                  aria-label={reveal ? "Hide value" : "Reveal value"}
                  title={reveal ? "Hide value" : "Reveal value"}
                  onClick={() => setReveal((r) => !r)}
                  className={cn(
                    "grid size-6 place-items-center rounded transition-colors",
                    reveal
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <I.eye width={12} height={12} />
                </button>
              )}
              {projectId && (
                <button
                  type="button"
                  aria-label="Insert reference"
                  title="Insert a ${{ resource.KEY }} reference"
                  onClick={onTogglePicker}
                  className={cn(
                    "grid size-6 place-items-center rounded transition-colors",
                    pickerOpen
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="font-mono text-[10.5px] leading-none">{"{ }"}</span>
                </button>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className="py-2 text-center">
          {v.required && v.value.trim() === "" && (
            <span
              title="Required — fill this in before the stack can deploy"
              aria-label="Required, empty"
              className="inline-flex text-destructive"
            >
              <HugeiconsIcon icon={AlertDiamondIcon} strokeWidth={2} className="size-4" />
            </span>
          )}
        </TableCell>
        <TableCell className="py-2 text-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={v.secret ? "Mark as plain" : "Mark as secret"}
            onClick={onToggleSecret}
            className={v.secret ? "text-foreground" : "text-muted-foreground"}
          >
            <I.lock width={12} height={12} />
          </Button>
        </TableCell>
        <TableCell className="py-2 text-right">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
            <I.x width={11} height={11} />
          </Button>
        </TableCell>
      </TableRow>
      {projectId && pickerOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="py-0 pb-2">
            <ReferencePicker projectId={projectId} onPick={onPick} onClose={onClosePicker} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/** Empty state: a dashed dropzone that accepts a dragged .env file or opens
 *  the bulk editor. */
export function EmptyDropzone({
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
export function BulkEditor({
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
