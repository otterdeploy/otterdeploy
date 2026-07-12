/**
 * First-load placeholder for the resource graph. Mirrors the real canvas — a
 * dotted background with a few node-sized cards wired together — so opening a
 * project paints instantly instead of flashing an empty canvas while the
 * resource / dependency / diff fetches resolve. Only shown on the very first
 * load of a project's resources; warm re-opens read from the collection cache
 * and skip it.
 */
import { Skeleton } from "@/shared/components/ui/skeleton";

// Rough node placements echoing a routes → services → databases layout so the
// skeleton reads as "a graph is loading" rather than scattered boxes.
const GHOST_NODES = [
  { top: "12%", left: "38%" },
  { top: "42%", left: "20%" },
  { top: "42%", left: "56%" },
  { top: "72%", left: "38%" },
];

export function GraphSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading resources"
      className="absolute inset-0 overflow-hidden"
    >
      {/* Dotted backdrop matching React Flow's Background gap={20} size={1}. */}
      <div
        className="absolute inset-0 opacity-40 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:20px_20px]"
      />
      {GHOST_NODES.map((pos, i) => (
        <div
          key={i}
          className="absolute flex w-56 flex-col gap-2 rounded-xl border bg-card/60 p-4"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
