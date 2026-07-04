import { Skeleton } from "@/shared/components/ui/skeleton";

/**
 * Placeholder for the resource drawer while its spec is still loading (a
 * just-staged ghost whose manifest hasn't resolved yet). Mirrors the real
 * panel's layout — header tile + title, status bar, tab row, body cards — so
 * the drawer never slides in blank.
 */
export function ResourcePanelSkeleton() {
  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      <Skeleton className="h-9 w-full rounded-md" />

      <div className="flex gap-2">
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
