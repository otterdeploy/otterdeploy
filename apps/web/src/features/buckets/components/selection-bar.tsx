/**
 * The bulk-action bar. It exists only while something is ticked, and it
 * totals a Map of key → size rather than the visible rows, because the
 * selection deliberately survives paging and prefix navigation.
 *
 * Delete confirms first: a bucket delete has no trash can.
 */
import { Delete02Icon, Download01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

import { formatSize } from "../state";

export function SelectionBar({
  count,
  bytes,
  isDeleting,
  onDownload,
  onCopyLinks,
  onDelete,
  onClear,
}: {
  count: number;
  bytes: number;
  isDeleting: boolean;
  onDownload: () => void;
  onCopyLinks: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t bg-primary/5 px-3 font-mono text-[11.5px] motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
      <b>{count} selected</b>
      <span className="text-muted-foreground">· {formatSize(bytes)}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        clear
      </button>
      <span className="flex-1" />
      <Button size="sm" variant="outline" className="h-6 gap-1.5 text-[12px]" onClick={onDownload}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
        Download
      </Button>
      <Button size="sm" variant="outline" className="h-6 gap-1.5 text-[12px]" onClick={onCopyLinks}>
        <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
        Copy links
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1.5 text-[12px] text-destructive"
              disabled={isDeleting}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} object{count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {formatSize(bytes)} will be removed from the bucket. There is no undo — S3 has no
              trash can.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
