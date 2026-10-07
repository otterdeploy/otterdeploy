/**
 * A destination row's controls. Split from ./destination-row for file size.
 */
import { Delete02Icon, Settings01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";

/**
 * Test / enable / opt-in / edit / delete.
 *
 * Its own component because every one of the row's conditions lands here —
 * managed or not, disabled or not, a backup target or a browse-only bucket —
 * and reading the row's layout should not mean reading five buttons' branches
 * first.
 */
export function DestinationControls({
  name,
  managed,
  busy,
  disabled,
  browseOnly,
  onTest,
  onToggleEnabled,
  onToggleUsedForBackups,
  onEdit,
  onRemove,
}: {
  /** The destination's name, for the delete confirmation. */
  name: string;
  managed: boolean;
  busy: boolean;
  disabled: boolean;
  browseOnly: boolean;
  onTest: () => void;
  onToggleEnabled: () => void;
  onToggleUsedForBackups: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    /* pl-9, not pl-11: these are ghost buttons whose own px-2.5 padding
       carries the rest of the way, so their LABELS line up with the name
       rather than their invisible box edges. */
    <div className="flex flex-wrap items-center gap-1 pl-9 lg:contents lg:pl-0">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        title="Validate stored credential"
        disabled={busy}
        onClick={onTest}
      >
        <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
        Test
      </Button>
      {browseOnly ? (
        // The explicit act. A connected bucket is inert until this is
        // clicked; no schedule can name it before then.
        <Button
          variant="ghost"
          size="sm"
          className="whitespace-nowrap"
          disabled={busy}
          title="Start writing backups into this bucket. Nothing is written until you do."
          onClick={onToggleUsedForBackups}
        >
          Use for backups
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          // Widest label ("Disable") sets the column so Enable/Disable rows align.
          className="lg:w-[76px]"
          disabled={busy}
          title={
            disabled
              ? "Resume sending backups here"
              : "Stop sending new backups here. Existing snapshots stay restorable."
          }
          onClick={onToggleEnabled}
        >
          {disabled ? "Enable" : "Disable"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={managed ? "Rename" : "Edit"}
        aria-label={managed ? "Rename" : "Edit"}
        disabled={busy}
        onClick={onEdit}
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
      </Button>
      {/* No delete for the managed destination. It must always exist, or the
            org is back to "configure storage before you can back anything up".
            Disable is the escape hatch. */}
      {managed ? (
        // Same footprint as the delete button so the managed row's controls
        // sit in the same columns as every other row's, rather than the
        // whole tail sliding one icon to the right.
        <span aria-hidden className="hidden size-7 lg:block" />
      ) : (
        // Access loss (where the stored snapshots live): a styled confirm.
        <TypedConfirmDialog
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Delete"
              aria-label={`Delete ${name}`}
              disabled={busy}
            >
              <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
            </Button>
          }
          title={`Delete the destination "${name}"?`}
          description="Nothing is written here again, and the saved credential is forgotten. A destination that still holds backups cannot be deleted: disable it instead, which keeps them restorable."
          confirmLabel="Delete destination"
          onConfirm={onRemove}
        />
      )}
    </div>
  );
}
