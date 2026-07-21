import {
  CircleUnlock01Icon,
  Copy01Icon,
  Delete02Icon,
  LockKeyIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ReferencePicker } from "@/features/projects/components/variables";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

import type { DraftRow, RowStatus } from "./use-editor-state";

import { hasOpenRefToken, insertRefToken } from "../ref-token";

const STATUS_TONE: Record<RowStatus, string> = {
  unchanged: "bg-transparent text-transparent",
  added: "bg-success/15 text-success",
  edited: "bg-warning/15 text-warning",
  deleted: "bg-destructive/15 text-destructive",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  unchanged: "·",
  added: "added",
  edited: "edited",
  deleted: "deleted",
};

interface EditorRowProps {
  row: DraftRow;
  status: RowStatus;
  projectId: string;
  revealed: boolean;
  copied: boolean;
  pickerOpen: boolean;
  onChange: (patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) => void;
  onPickerOpenChange: (open: boolean) => void;
  onToggleReveal: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function EditorRow({
  row,
  status,
  projectId,
  revealed,
  copied,
  pickerOpen,
  onChange,
  onPickerOpenChange,
  onToggleReveal,
  onCopy,
  onDelete,
}: EditorRowProps) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/30 px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <StatusPill status={status} />
        <Input
          value={row.key}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder="KEY"
          className="h-7 w-56 font-mono text-[12px]"
          spellCheck={false}
        />
        <ValueCell
          row={row}
          projectId={projectId}
          revealed={revealed}
          pickerOpen={pickerOpen}
          onChange={onChange}
          onPickerOpenChange={onPickerOpenChange}
          onToggleReveal={onToggleReveal}
        />
        <SecretToggle row={row} onChange={onChange} />
        <RevealToggle row={row} revealed={revealed} onToggleReveal={onToggleReveal} />
        <CopyAction copied={copied} onCopy={onCopy} />
        <RowAction
          icon={Delete02Icon}
          label="Delete row"
          tone="hover:text-destructive"
          onClick={onDelete}
        />
      </div>
      {showPickerHint(row.value, pickerOpen) && (
        <p className="pl-[5.5rem] text-[10.5px] text-muted-foreground">
          Tip: press the {"{ }"} button to finish this reference.
        </p>
      )}
    </div>
  );
}

function showPickerHint(value: string, pickerOpen: boolean) {
  return value.length > 0 && !pickerOpen && hasOpenRefToken(value);
}

function StatusPill({ status }: { status: RowStatus }) {
  return (
    <span
      className={cn(
        "mt-1.5 inline-flex rounded px-1 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase",
        STATUS_TONE[status],
      )}
      title={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

interface ValueCellProps {
  row: DraftRow;
  projectId: string;
  revealed: boolean;
  pickerOpen: boolean;
  onChange: EditorRowProps["onChange"];
  onPickerOpenChange: (open: boolean) => void;
  onToggleReveal: () => void;
}

function ValueCell({
  row,
  projectId,
  revealed,
  pickerOpen,
  onChange,
  onPickerOpenChange,
  onToggleReveal,
}: ValueCellProps) {
  const showValue = !row.isSecret || revealed;
  return (
    <div className="relative flex-1">
      <Input
        value={showValue ? row.value : row.value.replace(/./g, "•")}
        onChange={(e) => onChange({ value: e.target.value })}
        onFocus={() => {
          if (row.isSecret && !revealed) onToggleReveal();
        }}
        placeholder="value"
        className="h-7 w-full pr-9 font-mono text-[12px]"
        spellCheck={false}
      />
      {/* Popover, not an inline block: it renders in a portal so the picker
          floats over the rows below instead of pushing them down, and the
          refs list is cache-warmed at the editor level so it opens instantly. */}
      <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Insert reference"
              title="Insert reference"
              className={cn(
                "absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded transition-colors",
                pickerOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="font-mono text-[10.5px] leading-none">{"{ }"}</span>
            </button>
          }
        />
        <PopoverContent align="end" side="bottom" className="w-[26rem] p-0">
          <ReferencePicker
            projectId={projectId}
            excludeToken={row.value}
            onPick={(token) => onChange({ value: insertRefToken(row.value, token) })}
            onClose={() => onPickerOpenChange(false)}
            className="border-0 bg-transparent shadow-none"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SecretToggle({ row, onChange }: { row: DraftRow; onChange: EditorRowProps["onChange"] }) {
  return (
    <RowAction
      icon={row.isSecret ? LockKeyIcon : CircleUnlock01Icon}
      tone={row.isSecret ? "text-primary" : undefined}
      label={row.isSecret ? "Marked sensitive" : "Mark sensitive"}
      onClick={() => onChange({ isSecret: !row.isSecret })}
    />
  );
}

function RevealToggle({
  row,
  revealed,
  onToggleReveal,
}: {
  row: DraftRow;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  return (
    <RowAction
      icon={revealed ? ViewOffIcon : ViewIcon}
      label={revealed ? "Hide" : "Reveal"}
      onClick={onToggleReveal}
      disabled={!row.isSecret}
    />
  );
}

function CopyAction({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <RowAction
      icon={copied ? Tick02Icon : Copy01Icon}
      tone={copied ? "text-primary" : undefined}
      label={copied ? "Copied" : "Copy"}
      onClick={onCopy}
    />
  );
}

interface RowActionProps {
  icon: typeof Copy01Icon;
  label: string;
  onClick: () => void;
  tone?: string;
  disabled?: boolean;
}

function RowAction({ icon, label, onClick, tone, disabled }: RowActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        tone,
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
    </button>
  );
}
