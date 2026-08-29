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
import { omitUndefined } from "@otterdeploy/shared/object";
import { useTranslation } from "react-i18next";

import type { EnvIssue, EnvSuggestion } from "@/features/resources/env-catalog";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { DraftRow, RowStatus } from "./use-editor-state";

import { EnvKeyCombobox } from "../env-key-combobox";
import { hasOpenRefToken } from "../ref-token";
import { ValueCell } from "./value-cell";

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
  /** Known env vars for this resource's image (env catalog). Empty list =
   *  the key field stays a plain input. */
  suggestions: EnvSuggestion[];
  /** Keys the OTHER visible rows already use; excluded from suggestions. */
  takenKeys: ReadonlySet<string>;
  /** Another visible row carries the same (trimmed) key. Flags the key field
   *  and blocks Save until resolved: env is keyed by name, so saving both
   *  would silently keep one and drop the other. */
  duplicate: boolean;
  /** The value doesn't fit its schema (`EnvSuggestion.validate`). A `block`
   *  issue disables Save the same way a duplicate does; a `warn` is shown
   *  and never stands in the way. */
  issue?: EnvIssue | null;
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
  suggestions,
  takenKeys,
  duplicate,
  issue = null,
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
      {/* Side-by-side needs ~380px at minimum, a 14rem key field, the value
          field, and four icon buttons, so below `sm` the row stacks into
          key / value / actions. `sm:contents` dissolves the two mobile-only
          wrappers at `sm`, restoring the original single flex row exactly. */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
        <div className="flex min-w-0 items-start gap-2 sm:contents">
          <StatusPill status={status} />
          {suggestions.length > 0 ? (
            <EnvKeyCombobox
              value={row.key}
              suggestions={suggestions}
              takenKeys={takenKeys}
              onChange={(key) => onChange({ key })}
              // Picking fills the key, prefills a safe default when the value
              // is still empty, and marks credentials sensitive up front.
              // omitUndefined: an undefined `value`/`isSecret` must mean
              // "leave alone", not an explicit write.
              onPick={(s) =>
                onChange(
                  omitUndefined({
                    key: s.key,
                    value: row.value.trim() === "" ? s.defaultValue : undefined,
                    isSecret: s.secret ? true : undefined,
                  }),
                )
              }
              className="h-7 w-full min-w-0 font-mono text-[12px] sm:w-56 sm:flex-none"
              invalid={duplicate}
            />
          ) : (
            <Input
              value={row.key}
              onChange={(e) => onChange({ key: e.target.value })}
              placeholder="KEY"
              className="h-7 w-full min-w-0 font-mono text-[12px] sm:w-56 sm:flex-none"
              spellCheck={false}
              aria-invalid={duplicate || undefined}
            />
          )}
        </div>
        <ValueCell
          row={row}
          projectId={projectId}
          revealed={revealed}
          pickerOpen={pickerOpen}
          onChange={onChange}
          onPickerOpenChange={onPickerOpenChange}
          onToggleReveal={onToggleReveal}
        />
        <div className="flex items-center justify-end gap-0.5 sm:contents">
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
      </div>
      {duplicate && <DuplicateNote keyName={row.key.trim()} />}
      {!duplicate && issue && <IssueNote issue={issue} />}
      {showPickerHint(row.value, pickerOpen) && (
        <p className="text-[10.5px] text-muted-foreground sm:pl-[5.5rem]">
          Tip: press the {"{ }"} button to finish this reference.
        </p>
      )}
    </div>
  );
}

function showPickerHint(value: string, pickerOpen: boolean) {
  return value.length > 0 && !pickerOpen && hasOpenRefToken(value);
}

/** Schema verdict under the row: warnings in the warning tone, blockers in
 *  the destructive tone — the same visual grammar as the duplicate note, so
 *  "this stops Save" reads identically whatever the cause. */
function IssueNote({ issue }: { issue: EnvIssue }) {
  return (
    <p
      className={
        issue.level === "block"
          ? "text-[10.5px] text-destructive sm:pl-[5.5rem]"
          : "text-[10.5px] text-warning sm:pl-[5.5rem]"
      }
    >
      {issue.message}
    </p>
  );
}

function DuplicateNote({ keyName }: { keyName: string }) {
  const { t } = useTranslation();
  return (
    <p className="text-[10.5px] text-destructive sm:pl-[5.5rem]">
      {t("resources.variables.duplicateNote", { key: keyName })}
    </p>
  );
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
