/**
 * The bulk-action bar. It exists only while something is ticked, and it
 * totals a Map of key → size rather than the visible rows, because the
 * selection deliberately survives paging and prefix navigation.
 *
 * Delete confirms first: a bucket delete has no trash can. A ticked FOLDER
 * raises the stakes again — it means every key under it, including ones this
 * page never listed — so the dialog names that rather than counting rows.
 *
 * Download and copy-links act on files only: a folder has no bytes of its own,
 * so they go quiet when nothing but folders is ticked instead of appearing to
 * work and doing nothing.
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
  folderCount,
  bytes,
  isDeleting,
  onDownload,
  onCopyLinks,
  onDelete,
  onClear,
}: {
  count: number;
  /** How many of `count` are folders. The rest are files. */
  folderCount: number;
  bytes: number;
  isDeleting: boolean;
  onDownload: () => void;
  onCopyLinks: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const fileCount = count - folderCount;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t bg-primary/5 px-3 font-mono text-[11.5px] motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
      <b>{selectionLabel(fileCount, folderCount)}</b>
      <span className="text-muted-foreground">· {formatSize(bytes)}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        clear
      </button>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1.5 text-[12px]"
        disabled={fileCount === 0}
        onClick={onDownload}
      >
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
        Download
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1.5 text-[12px]"
        disabled={fileCount === 0}
        onClick={onCopyLinks}
      >
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
            <AlertDialogTitle>Delete {selectionLabel(fileCount, folderCount)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {folderCount > 0
                ? `Everything under ${folderCount === 1 ? "the folder" : "those folders"} goes too, including keys this page never listed. `
                : `${formatSize(bytes)} will be removed from the bucket. `}
              There is no undo — S3 has no trash can.
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

/** "3 files and 1 folder", skipping whichever half is zero. */
function selectionLabel(fileCount: number, folderCount: number): string {
  const parts: string[] = [];
  if (fileCount > 0) parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  if (folderCount > 0) parts.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
  return parts.join(" and ");
}
