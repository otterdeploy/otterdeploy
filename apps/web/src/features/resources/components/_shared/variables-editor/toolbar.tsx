import { Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";

interface ToolbarProps {
  totalCount: number;
  hasPending: boolean;
  diff: { added: number; edited: number; deleted: number };
  saving: boolean;
  onBulkEdit: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function Toolbar({
  totalCount,
  hasPending,
  diff,
  saving,
  onBulkEdit,
  onDiscard,
  onSave,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        {totalCount} User Variables
        {hasPending && (
          <span className="text-[11.5px] font-normal text-muted-foreground">
            · <DiffSummary diff={diff} />
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
        disabled={!hasPending || saving}
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
