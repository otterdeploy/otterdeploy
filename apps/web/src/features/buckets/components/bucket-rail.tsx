/**
 * The prefix tree, and nothing else — the bucket switcher lives in the
 * header's crumb trail, so the whole rail belongs to navigation inside the
 * bucket.
 *
 * The tree shows what this view can actually see — the ancestors of where
 * you stand, the prefixes on this page, and the children the stats scan
 * walked — rather than pretending to enumerate a keyspace S3 cannot
 * enumerate cheaply. What it shows is exactly what clicking will open.
 */
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import { basename } from "../state";

export function BucketRail({
  knownPrefixes,
  activePrefix,
  onPickPrefix,
}: {
  knownPrefixes: readonly string[];
  activePrefix: string;
  onPickPrefix: (prefix: string) => void;
}) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 md:flex">
      {/* h-10 to the pixel, like the browse bar and the preview header: the
          three panes' first border-b must read as ONE line. */}
      <div className="flex h-10 shrink-0 items-center border-b px-2.5 font-mono text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Prefixes
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {knownPrefixes.length === 0 ? (
          <p className="px-1.5 py-1 font-mono text-[11px] text-muted-foreground">none yet</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {knownPrefixes.map((p) => {
              const depth = p.replace(/\/+$/, "").split("/").length - 1;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPickPrefix(p)}
                  aria-current={p === activePrefix ? "true" : undefined}
                  style={{ paddingLeft: `${6 + depth * 12}px` }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md py-1 pr-1.5 text-left font-mono text-[11.5px] transition-colors",
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
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
