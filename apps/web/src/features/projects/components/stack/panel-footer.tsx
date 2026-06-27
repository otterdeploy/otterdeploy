/**
 * Footer strip for the StackCodePanel — filename pill, edit/diff
 * toggles, line counter, Discard / Apply buttons.
 */

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type PanelViewMode = "edit" | "diff";

export interface PanelFooterProps {
  filename: string;
  lineCount: number;
  view: PanelViewMode;
  onViewChange: (v: PanelViewMode) => void;
  editing: boolean;
  onEditToggle: () => void;
  dirty: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onApply: () => void;
}

export function PanelFooter(props: PanelFooterProps) {
  return (
    <div className="flex h-10 items-center gap-2 px-3 text-[12px]">
      <span className="rounded-md border border-border/40 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
        {props.filename}
      </span>
      <button
        type="button"
        onClick={props.onEditToggle}
        className={cn(
          "rounded-md px-2 py-0.5 text-[11px] transition-colors",
          props.editing
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {props.editing ? "editing" : "edit"}
      </button>
      <button
        type="button"
        onClick={() => props.onViewChange(props.view === "diff" ? "edit" : "diff")}
        className={cn(
          "rounded-md px-2 py-0.5 text-[11px] transition-colors",
          props.view === "diff"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        diff vs prod
      </button>
      <span className="ml-auto text-[11.5px] text-muted-foreground">{props.lineCount} lines</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={!props.dirty || props.isSaving}
        onClick={props.onDiscard}
        className="h-7 text-[12px]"
      >
        Discard
      </Button>
      <Button
        size="sm"
        disabled={!props.dirty || props.isSaving}
        onClick={props.onApply}
        className="h-7 gap-1.5 text-[12px]"
      >
        <kbd className="rounded bg-foreground/10 px-1 font-mono text-[10px]">⌘S</kbd>
        {props.isSaving ? "Applying…" : "Apply"}
      </Button>
    </div>
  );
}
