/**
 * Chrome around the per-env variables table — the search/actions toolbar,
 * the drag-drop overlay, and the dashed drop hint under the table.
 */
import {
  AddSquareIcon,
  Copy01Icon,
  Download01Icon,
  FilterIcon,
  Search01Icon,
  Upload01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export function VariablesToolbar({
  q,
  onQChange,
  hasRows,
  downloadName,
  onDownload,
  revealAll,
  onToggleReveal,
  onBulkOpen,
}: {
  q: string;
  onQChange: (q: string) => void;
  hasRows: boolean;
  downloadName: string;
  onDownload: () => void;
  revealAll: boolean;
  onToggleReveal: () => void;
  onBulkOpen: () => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="relative flex-1 max-w-sm">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search by secret, folder, tag or metadata…"
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          className="h-8 pl-8"
        />
      </div>
      <Button variant="outline" size="sm" className="gap-1.5">
        <HugeiconsIcon icon={FilterIcon} className="size-3.5" />
        Filters
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Download .env"
        title={hasRows ? `Download ${downloadName}` : "No variables to download"}
        disabled={!hasRows}
        onClick={onDownload}
      >
        <HugeiconsIcon icon={Download01Icon} className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={revealAll ? "Hide secrets" : "Reveal secrets"}
        onClick={onToggleReveal}
      >
        <HugeiconsIcon icon={ViewIcon} className="size-3.5" />
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onBulkOpen}>
        <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
        Bulk edit
      </Button>
      <Button size="sm" className="gap-1.5" onClick={onBulkOpen}>
        <HugeiconsIcon icon={AddSquareIcon} className="size-3.5" />
        Add secret
      </Button>
    </div>
  );
}

export function DragOverlay({ envLabel }: { envLabel: string }) {
  return (
    <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-md bg-background/85 ring-2 ring-inset ring-primary/60">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <HugeiconsIcon icon={Upload01Icon} className="size-5 text-primary" />
        <div className="text-sm font-medium">
          Drop <code className="font-mono">.env</code> to import into{" "}
          <span className="capitalize">{envLabel}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Opens bulk edit for review — nothing is saved until you apply.
        </div>
      </div>
    </div>
  );
}

export function DropHint({ onBulkOpen }: { onBulkOpen: () => void }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/10 px-6 py-8 text-center">
      <HugeiconsIcon
        icon={Upload01Icon}
        className="size-5 text-muted-foreground"
      />
      <div className="text-sm text-foreground/80">
        Drag a <code className="font-mono">.env</code> file anywhere on this
        tab, or paste into bulk edit.
      </div>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onBulkOpen}>
        <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
        Open bulk edit
      </Button>
    </div>
  );
}
