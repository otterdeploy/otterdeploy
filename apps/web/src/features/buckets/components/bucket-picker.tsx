/**
 * The workbench's front door: every bucket it can open, none of them opened.
 *
 * The same treatment the data workbench gives databases (`TargetPicker`).
 * Opening whatever happened to be first in the list was a guess, and a wrong
 * one costs a listing against a bucket nobody asked about — so which bucket
 * you are looking at is a choice you make, and `?bucket=` records it.
 */
import { FolderLibraryIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

import type { BucketRow } from "../data/buckets-data";

import { providerLabel } from "../state";

export function BucketPicker({
  buckets,
  onPick,
  onConnect,
}: {
  buckets: readonly BucketRow[];
  onPick: (id: string) => void;
  onConnect: () => void;
}) {
  if (buckets.length === 0) {
    return (
      <Empty className="flex-1 justify-center">
        <EmptyHeader>
          <HugeiconsIcon
            icon={FolderLibraryIcon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>No buckets to browse</EmptyTitle>
          <EmptyDescription>
            Connect any S3-compatible bucket — AWS, R2, MinIO — and it becomes browsable here, with
            one stored credential.
          </EmptyDescription>
        </EmptyHeader>
        <Button size="sm" onClick={onConnect}>
          Connect a bucket
        </Button>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-xl">
        <h2 className="text-[15px] font-medium">Open a bucket</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Nothing is listed until you pick one. Where you are then lives in the URL, so any view is
          a link.
        </p>
        <ul className="mt-6 divide-y overflow-hidden rounded-md ring-1 ring-foreground/10">
          {buckets.map((bucket) => (
            <li key={bucket.id}>
              <button
                type="button"
                disabled={bucket.status === "disabled"}
                onClick={() => onPick(bucket.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                  bucket.status === "disabled"
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <HugeiconsIcon
                  icon={FolderLibraryIcon}
                  strokeWidth={1.8}
                  className="size-5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{bucket.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {bucket.bucket}
                    {bucket.root === "" ? "" : `/${bucket.root}`} · {providerLabel(bucket)}
                  </span>
                </span>
                {bucket.status === "active" ? null : (
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[9.5px] tracking-wide uppercase",
                      bucket.status === "degraded" ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    {bucket.status}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" className="mt-6 gap-1.5" onClick={onConnect}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Connect a bucket
        </Button>
      </div>
    </div>
  );
}
