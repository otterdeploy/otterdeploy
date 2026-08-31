import { omitUndefined } from "@otterdeploy/shared/object";
import { useTranslation } from "react-i18next";

import type { EnvIssue, EnvSuggestion } from "@/features/resources/env-catalog";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { DraftRow, RowStatus } from "./use-editor-state";

import { EnvKeyCombobox } from "../env-key-combobox";
import { hasOpenRefToken } from "../ref-token";
import {
  CopyAction,
  DeleteAction,
  RevealToggle,
  RowApplyActions,
  SecretToggle,
} from "./editor-row-actions";
import { provenanceLabel, provenanceOf } from "./provenance";
import { ValueCell } from "./value-cell";

/**
 * Status is a DOT, not a word.
 *
 * The word changes width as a row goes clean → edited, which shifted the key
 * field while you were typing in it, and reserving the widest word left a band
 * of empty space at the head of every unchanged row. A fixed 6px dot says the
 * same thing, and the word rides its tooltip.
 */
const STATUS_TONE: Record<RowStatus, string> = {
  unchanged: "bg-transparent",
  added: "bg-success/70",
  edited: "bg-warning/80",
  deleted: "bg-destructive/70",
};

/** Notes (duplicate, schema issue, reference hint) describe the VALUE, so they
 *  align with the value field rather than sitting under the key. Status dot +
 *  gap + the 14rem key field + gap. */
const NOTE_INDENT = "sm:pl-[calc(0.375rem+0.5rem+14rem+0.5rem)]";

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
  /** What this value resolves to once `${{…}}` references are expanded, from
   *  service.env.effective. Undefined when the surface does not resolve (a
   *  database panel, a staged manifest edit) or the row has no reference. */
  resolved?: { value: string; unresolved: boolean };
  copied: boolean;
  pickerOpen: boolean;
  onChange: (patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) => void;
  onPickerOpenChange: (open: boolean) => void;
  onToggleReveal: () => void;
  onCopy: () => void;
  onDelete: () => void;
  /** Apply just this variable. Env vars are independent values, and one
   *  blocking issue anywhere disables the whole Save — so shipping a single
   *  corrected credential should not wait on the rest of the draft. */
  onApply?: () => void;
  /** Undo just this variable, back to what the server has. */
  onRevert?: () => void;
  applying?: boolean;
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
  resolved,
  copied,
  pickerOpen,
  onChange,
  onPickerOpenChange,
  onToggleReveal,
  onCopy,
  onDelete,
  onApply,
  onRevert,
  applying = false,
}: EditorRowProps) {
  const dirty = status !== "unchanged";
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
          {/* Fixed slot: the buttons appear and disappear with the row's
              dirty state, and a shifting row while you type is worse than a
              little reserved space. */}
          {onApply && (
            <RowApplyActions
              dirty={dirty}
              blocked={!!issue || duplicate}
              applying={applying}
              onApply={onApply}
              {...(onRevert ? { onRevert } : {})}
            />
          )}
          <SecretToggle row={row} onChange={onChange} />
          <RevealToggle row={row} revealed={revealed} onToggleReveal={onToggleReveal} />
          <CopyAction copied={copied} onCopy={onCopy} />
          <DeleteAction onDelete={onDelete} />
        </div>
      </div>
      <ProvenanceChips value={row.value} />
      {resolved && <ResolvedNote resolved={resolved} />}
      {duplicate && <DuplicateNote keyName={row.key.trim()} />}
      {!duplicate && issue && <IssueNote issue={issue} />}
      {showPickerHint(row.value, pickerOpen) && (
        <p className={cn("text-[10.5px] text-muted-foreground", NOTE_INDENT)}>
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
      className={cn(
        "text-[10.5px]",
        NOTE_INDENT,
        issue.level === "block" ? "text-destructive" : "text-warning",
      )}
    >
      {issue.message}
    </p>
  );
}

/**
 * What this value reads: `project`, `vault`, a sibling's name.
 *
 * Scoped to a claim the data supports. Nothing is INHERITED here — the project
 * bag reaches a service only through an explicit `${{project.KEY}}` token, and
 * there is no stack bag at all (od-1w02) — so these say "reads", never
 * "inherited from". A row that reads nothing gets no chip: "set here" on every
 * unremarkable row is noise, and most rows are unremarkable.
 */
function ProvenanceChips({ value }: { value: string }) {
  const sources = provenanceOf(value)
    .map(provenanceLabel)
    .filter((label): label is string => label !== null);
  if (sources.length === 0) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-1 text-[10.5px]", NOTE_INDENT)}>
      <span className="text-muted-foreground">reads</span>
      {sources.map((label) => (
        <span
          key={label}
          className="rounded-sm bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </p>
  );
}

/**
 * What the container will actually get.
 *
 * A value like `postgres://…@${{stack.db.HOST}}:5432/x` is the thing you edit
 * and the wrong thing to read: "is this pointing at the right database" is a
 * question about the resolved string. Shown under the row rather than in place
 * of it, because the template is still what you are editing.
 *
 * A reference that does not resolve is the case worth opening this for, so it
 * says so in the blocking tone instead of quietly rendering the raw text.
 */
function ResolvedNote({ resolved }: { resolved: { value: string; unresolved: boolean } }) {
  if (resolved.unresolved) {
    return (
      <p className={cn("text-[10.5px] text-destructive", NOTE_INDENT)}>
        This reference does not resolve.
      </p>
    );
  }
  return (
    <p className={cn("truncate font-mono text-[10.5px] text-muted-foreground", NOTE_INDENT)}>
      <span className="font-sans">resolves to </span>
      {resolved.value}
    </p>
  );
}

function DuplicateNote({ keyName }: { keyName: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("text-[10.5px] text-destructive", NOTE_INDENT)}>
      {t("resources.variables.duplicateNote", { key: keyName })}
    </p>
  );
}

function StatusPill({ status }: { status: RowStatus }) {
  return (
    <span
      aria-label={status === "unchanged" ? undefined : status}
      className={cn("mt-2.5 size-1.5 shrink-0 rounded-full", STATUS_TONE[status])}
      title={status === "unchanged" ? undefined : status}
    />
  );
}
