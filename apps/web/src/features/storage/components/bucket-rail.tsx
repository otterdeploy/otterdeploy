/**
 * The bucket list and the prefix tree, in one rail.
 *
 * The tree shows the prefixes ON THE CURRENT PAGE rather than the whole
 * keyspace: S3 has no cheap way to enumerate every prefix in a bucket, and a
 * tree that quietly showed only the first 200 would be a tree that lies. What
 * it shows is exactly what the listing found, which is also what clicking one
 * will open.
 */
import { Folder01Icon, Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { BucketRow } from "../data/buckets";

import { basename } from "../browse-state";

export function BucketRail({
  buckets,
  activeBucketId,
  prefixes,
  activePrefix,
  onPickBucket,
  onPickPrefix,
  isLoading,
}: {
  buckets: readonly BucketRow[];
  activeBucketId: string;
  prefixes: readonly string[];
  activePrefix: string;
  onPickBucket: (id: string) => void;
  onPickPrefix: (prefix: string) => void;
  isLoading: boolean;
}) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 md:flex">
      <div className="px-2.5 pt-2.5 pb-1 font-mono text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Buckets
      </div>
      <div className="flex flex-col gap-0.5 px-1.5">
        {isLoading ? (
          <RailSkeleton />
        ) : buckets.length === 0 ? (
          <p className="px-1.5 py-1 text-[12px] text-muted-foreground">No S3 destinations yet.</p>
        ) : (
          buckets.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onPickBucket(b.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors",
                b.id === activeBucketId
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={Database02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={b.bucket}>
                {b.name}
              </span>
            </button>
          ))
        )}
      </div>

      {prefixes.length > 0 ? (
        <>
          <div className="px-2.5 pt-3 pb-1 font-mono text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            Prefixes here
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            <div className="flex flex-col gap-0.5">
              {prefixes.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPickPrefix(p)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-1.5 py-1 text-left font-mono text-[11.5px] transition-colors",
                    p === activePrefix
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">{basename(p)}/</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}
    </aside>
  );
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}
