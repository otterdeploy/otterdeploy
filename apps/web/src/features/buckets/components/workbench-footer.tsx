/**
 * The status bar: one line, full width, never wraps.
 *
 * Honest about paging — S3 answers page by page with no random access, so
 * the pager is prev/next over a token stack, and a truncated first page is
 * named as such so "12 objects" is never read as "this bucket has 12
 * objects".
 */
import { Button } from "@/shared/components/ui/button";

import { formatSize } from "../state";

export function WorkbenchFooter({
  pageSize,
  objectCount,
  prefixCount,
  objectBytes,
  truncated,
  pageIndex,
  hasNextPage,
  onPrevPage,
  onNextPage,
}: {
  pageSize: number;
  objectCount: number;
  prefixCount: number;
  objectBytes: number;
  truncated: boolean;
  pageIndex: number;
  hasNextPage: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden border-t px-3 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
      <span className="truncate">
        {objectCount} object{objectCount === 1 ? "" : "s"}
        {prefixCount > 0 ? ` · ${prefixCount} prefix${prefixCount === 1 ? "" : "es"}` : ""}
        {objectCount > 0 ? ` · ${formatSize(objectBytes)}` : ""}
      </span>
      {truncated && !hasNextPage && pageIndex === 0 ? <span>· first page only</span> : null}
      <span className="flex-1" />
      {pageIndex > 0 || hasNextPage ? (
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 font-mono text-[11px]"
            disabled={pageIndex === 0}
            onClick={onPrevPage}
          >
            ‹ prev
          </Button>
          <span>page {pageIndex + 1}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 font-mono text-[11px]"
            disabled={!hasNextPage}
            onClick={onNextPage}
          >
            next ›
          </Button>
        </span>
      ) : null}
      <span className="hidden sm:inline">{pageSize}/page</span>
    </div>
  );
}
