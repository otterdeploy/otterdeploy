/**
 * The rail: the bucket tree, and nothing else — the bucket switcher lives in
 * the header's crumb trail, so the whole rail belongs to navigation inside
 * the bucket. The tree itself is `prefix-tree`.
 */
import { PrefixTree } from "./prefix-tree";

export function BucketRail({
  bucketId,
  activePrefix,
  onPickPrefix,
  onPickObject,
}: {
  bucketId: string;
  activePrefix: string;
  onPickPrefix: (prefix: string) => void;
  onPickObject: (key: string) => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r md:flex">
      {/* h-10 to the pixel, like the browse bar and the preview header: the
          three panes' first border-b must read as ONE line. */}
      <div className="flex h-10 shrink-0 items-center border-b px-2.5 font-mono text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Prefixes
      </div>
      <PrefixTree
        bucketId={bucketId}
        activePrefix={activePrefix}
        onNavigate={onPickPrefix}
        onPickObject={onPickObject}
      />
    </aside>
  );
}
