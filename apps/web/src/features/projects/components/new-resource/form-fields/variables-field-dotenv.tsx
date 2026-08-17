/**
 * The bulk half of the VariablesField: dotenv parse/serialize plus the two
 * surfaces that use them. The empty-state dropzone and the paste-a-whole-file
 * editor. Split out of variables-field-parts.tsx (which kept growing past the
 * line cap) because this is one concern end to end: getting a `.env` block in
 * and out of the row list, as opposed to editing a single row.
 *
 * Re-exported from variables-field-parts.tsx so the field imports from one
 * place.
 */

import { useState } from "react";

import { isSecretKey } from "@otterdeploy/shared/env-var-kind";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

import type { Var } from "./variables-field";

import { I } from "../icons";

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
    out.push({ key, value, secret: isSecretKey(key) });
  }
  return out;
}

export function serializeEnv(vars: Var[]): string {
  return vars.map((v) => `${v.key}=${v.value}`).join("\n");
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

/** Textarea bulk editor: paste a whole .env block, parsed on Apply. */
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
