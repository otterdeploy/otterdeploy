/**
 * Loading placeholder for the projects list. Mirrors the real layout — page
 * header + a responsive grid of project cards — so the page doesn't jump when
 * data arrives. Used as the route `pendingComponent` and the live-query
 * loading fallback.
 */
import { Page } from "@/shared/components/page";
import { Skeleton } from "@/shared/components/ui/skeleton";

export function ProjectsSkeleton() {
  return (
    <Page>
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-32" />
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-20 w-full rounded-md" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
