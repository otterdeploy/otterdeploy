// Bulk edit dialog — pre-fills with the current draft as a `.env` body so
// the operator can edit inline OR paste over the top. Apply runs a single
// replaceAll on the draft (baselines for unchanged keys survive so the
// per-row status pills still tell the truth).

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";

import { parseDotenv, serializeDotenv } from "./dotenv-parse";
import type { DraftRow } from "./use-editor-state";

interface BulkEditDialogProps {
  open: boolean;
  rows: DraftRow[];
  onClose: () => void;
  onApply: (entries: { key: string; value: string; isSecret: boolean }[]) => void;
}

export function BulkEditDialog({ open, rows, onClose, onApply }: BulkEditDialogProps) {
  const initial = useMemo(
    () => serializeDotenv(rows.map((r) => ({ key: r.key, value: r.value }))),
    [rows],
  );
  const [text, setText] = useState(initial);

  // Reset to the live draft whenever the dialog re-opens so cancel really
  // does cancel — staying open between sessions keeps edits but a close+
  // reopen always starts from the current state.
  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);

  const parsed = useMemo(() => parseDotenv(text), [text]);
  const secretMap = useMemo(
    () => new Map(rows.map((r) => [r.key, r.isSecret] as const)),
    [rows],
  );
  const secretCount = parsed.filter((e) => secretMap.get(e.key)).length;

  const pasteFromClipboard = async () => {
    const clip = await navigator.clipboard?.readText().catch(() => "");
    if (!clip) return;
    setText(clip);
  };

  const apply = () => {
    onApply(
      parsed.map((e) => ({
        key: e.key,
        value: e.value,
        isSecret: secretMap.get(e.key) ?? false,
      })),
    );
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk edit · variables</DialogTitle>
          <DialogDescription>
            Paste a <span className="font-mono">.env</span> or edit inline. Comments and blank
            lines are ignored. Applying replaces the current draft — save afterwards to
            commit.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
          <span>
            <span className="font-mono">.env</span> format · <span className="font-mono">#</span>{" "}
            comments ok · <span className="font-mono">KEY=value</span>
          </span>
          <button
            type="button"
            onClick={pasteFromClipboard}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] text-foreground/80 hover:bg-muted"
          >
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
            Paste from clipboard
          </button>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={`# KEY=value pairs, one per line\nDATABASE_URL=postgres://...\nDEBUG=1`}
          className="min-h-[300px] resize-y font-mono text-[12px] leading-relaxed"
          autoFocus
        />

        <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
          <span>{parsed.length} variables parsed</span>
          {secretCount > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{secretCount} marked secret</span>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={parsed.length === 0 && text.trim().length > 0}>
            Apply {parsed.length} {parsed.length === 1 ? "var" : "vars"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
