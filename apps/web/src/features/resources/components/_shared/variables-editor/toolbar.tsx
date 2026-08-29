import { Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

interface ToolbarProps {
  totalCount: number;
  /** Count heading ("User Variables"). `null` hides the count entirely.
   *  Used when the surrounding tab already renders its own count header,
   *  so the same rows aren't counted twice under two names. */
  countLabel?: string | null;
  hasPending: boolean;
  diff: { added: number; edited: number; deleted: number };
  /** Distinct keys duplicated across rows. Non-zero blocks Save: env is
   *  keyed by name, so saving would silently drop all but one row. */
  duplicateCount: number;
  /** Rows failing a REQUIRED schema check (see `EnvSuggestion.validate`).
   *  Non-zero blocks Save: the value would deploy and the app would not
   *  start on it. Warn-level issues are shown under rows and never counted
   *  here. */
  blockingIssueCount?: number;
  saving: boolean;
  onBulkEdit: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function Toolbar({
  totalCount,
  countLabel = "User Variables",
  hasPending,
  diff,
  duplicateCount,
  blockingIssueCount = 0,
  saving,
  onBulkEdit,
  onDiscard,
  onSave,
}: ToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        {countLabel !== null && (
          <span>
            {totalCount} {countLabel}
          </span>
        )}
        {hasPending && (
          <span className="text-[11.5px] font-normal text-muted-foreground">
            {countLabel !== null && "· "}
            <DiffSummary diff={diff} />
          </span>
        )}
        {duplicateCount > 0 && (
          <span className="text-[11.5px] font-normal text-destructive">
            · {t("resources.variables.duplicateCount", { count: duplicateCount })}
          </span>
        )}
        {blockingIssueCount > 0 && (
          <span className="text-[11.5px] font-normal text-destructive">
            · {t("resources.variables.schemaIssueCount", { count: blockingIssueCount })}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={onBulkEdit}>
        <HugeiconsIcon icon={Database02Icon} strokeWidth={2} className="size-3.5" />
        Bulk edit
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-[12px]"
        disabled={!hasPending || saving}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button
        size="sm"
        className="h-7 text-[12px]"
        disabled={!hasPending || saving || duplicateCount > 0 || blockingIssueCount > 0}
        title={
          duplicateCount > 0
            ? t("resources.variables.duplicateBlocksSave")
            : blockingIssueCount > 0
              ? t("resources.variables.schemaIssueBlocksSave")
              : undefined
        }
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function DiffSummary({ diff }: { diff: { added: number; edited: number; deleted: number } }) {
  const parts: string[] = [];
  if (diff.added) parts.push(`${diff.added} added`);
  if (diff.edited) parts.push(`${diff.edited} edited`);
  if (diff.deleted) parts.push(`${diff.deleted} deleted`);
  return <>{parts.join(" · ")}</>;
}
