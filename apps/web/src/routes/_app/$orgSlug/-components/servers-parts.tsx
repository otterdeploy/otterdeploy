import { HugeiconsIcon } from "@hugeicons/react";

import { Page } from "@/shared/components/page";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

type IconType = Parameters<typeof HugeiconsIcon>[0]["icon"];

export function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconType;
  label: string;
  value: string;
  sub: string;
}) {
  const isPlaceholder = value === "—";
  return (
    <Card className="rounded-md">
      <CardContent className="flex items-center gap-3">
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <HugeiconsIcon
            icon={icon}
            strokeWidth={1.8}
            className="size-4 shrink-0"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {label}
          </div>
          <div
            className={cn(
              "mt-0.5 text-lg font-semibold leading-tight",
              isPlaceholder && "text-muted-foreground/40",
            )}
          >
            {value}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function FilterPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-foreground bg-card text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

export function ServersPending() {
  return (
    <Page>
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-md">
            <CardContent className="flex items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden rounded-md p-0 gap-0">
        <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-16 rounded-sm" />
            <Skeleton className="h-7 w-24 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="size-4 rounded-sm" />
          </div>
        ))}
      </Card>
    </Page>
  );
}
