/**
 * The action cluster at the end of a variables row: apply / revert this one
 * variable, mark sensitive, reveal, copy, delete. Split out of
 * `editor-row.tsx` under the file-length cap; the row owns the layout, this
 * owns what each button means.
 */

import {
  ArrowReloadHorizontalIcon,
  CircleUnlock01Icon,
  Copy01Icon,
  Delete02Icon,
  LockKeyIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { DraftRow } from "./use-editor-state";

export function SecretToggle({
  row,
  onChange,
}: {
  row: DraftRow;
  onChange: (patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) => void;
}) {
  return (
    <RowAction
      icon={row.isSecret ? LockKeyIcon : CircleUnlock01Icon}
      tone={row.isSecret ? "text-primary" : undefined}
      label={row.isSecret ? "Marked sensitive" : "Mark sensitive"}
      onClick={() => onChange({ isSecret: !row.isSecret })}
    />
  );
}

export function RevealToggle({
  row,
  revealed,
  onToggleReveal,
}: {
  row: DraftRow;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  // A sealed row's value never left the server, so there is nothing to reveal
  // and the control says why rather than sitting there looking broken.
  if (row.sealed) {
    return (
      <RowAction
        icon={ViewIcon}
        label="Write-only: cannot be read back"
        onClick={() => {}}
        disabled
      />
    );
  }
  return (
    <RowAction
      icon={revealed ? ViewOffIcon : ViewIcon}
      label={revealed ? "Hide" : "Reveal"}
      onClick={onToggleReveal}
      disabled={!row.isSecret}
    />
  );
}

export function CopyAction({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <RowAction
      icon={copied ? Tick02Icon : Copy01Icon}
      tone={copied ? "text-primary" : undefined}
      label={copied ? "Copied" : "Copy"}
      onClick={onCopy}
    />
  );
}

/**
 * Apply / revert THIS variable.
 *
 * Rendered in a fixed-width slot so the buttons appearing with the row's dirty
 * state never shift the fields you are typing in. Apply is blocked by the same
 * things that block the global Save — a duplicate key or a schema violation
 * would persist a value the app cannot start on either way.
 */
/** Remove the row (tombstoned until save, so it can be restored). */
export function DeleteAction({ onDelete }: { onDelete: () => void }) {
  return (
    <RowAction
      icon={Delete02Icon}
      label="Delete row"
      tone="hover:text-destructive"
      onClick={onDelete}
    />
  );
}

export function RowApplyActions({
  dirty,
  blocked,
  applying,
  onApply,
  onRevert,
}: {
  dirty: boolean;
  blocked: boolean;
  applying: boolean;
  onApply: () => void;
  onRevert?: () => void;
}) {
  return (
    <div className="flex w-[3.25rem] shrink-0 items-center justify-end gap-0.5">
      {dirty && (
        <>
          <RowAction
            icon={Tick02Icon}
            label="Apply just this variable"
            tone="hover:text-success"
            disabled={applying || blocked}
            onClick={onApply}
          />
          <RowAction
            icon={ArrowReloadHorizontalIcon}
            label="Revert this variable"
            onClick={() => onRevert?.()}
          />
        </>
      )}
    </div>
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
