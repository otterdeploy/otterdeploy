/**
 * Org-wide databases catalog — every database resource across the org's
 * projects as cards, with a project filter strip and an "Add database" flow
 * that routes into a chosen project's deploy wizard (`?new=service` opens the
 * kind picker, where Database is one tile). Data comes from one polled
 * endpoint; see features/databases/data.ts.
 */
import { useState } from "react";

import { Database02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { useDatabaseCatalog } from "./data";
import { DatabaseCard } from "./db-card";
import { ALL_PROJECTS } from "./shared";

export function DatabasesPage({ orgSlug }: { orgSlug: string }) {
  const { data, isPending, isError, refetch } = useDatabaseCatalog();
  const databases = data?.databases ?? [];
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);

  // Chips for every project that actually has a database, with counts.
  const projectCounts = new Map<string, number>();
  for (const db of databases)
    projectCounts.set(db.projectSlug, (projectCounts.get(db.projectSlug) ?? 0) + 1);

  const filtered =
    filter === ALL_PROJECTS ? databases : databases.filter((d) => d.projectSlug === filter);

  return (
    <Page>
      <PageHeader
        title="Databases"
        description="Every database across your projects — status, size, connections, backup freshness"
        actions={<AddDatabaseMenu orgSlug={orgSlug} />}
      />

      {databases.length > 0 && (
        <div className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 p-0.5">
          <FilterChip
            active={filter === ALL_PROJECTS}
            onClick={() => setFilter(ALL_PROJECTS)}
            label="All projects"
            count={databases.length}
          />
          {[...projectCounts.entries()].map(([slug, count]) => (
            <FilterChip
              key={slug}
              active={filter === slug}
              onClick={() => setFilter(slug)}
              label={slug}
              count={count}
            />
          ))}
        </div>
      )}

      {isPending ? (
        <CardSkeletons />
      ) : isError ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Couldn't load databases</EmptyTitle>
            <EmptyDescription>The catalog request failed. Try again.</EmptyDescription>
          </EmptyHeader>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </Empty>
      ) : databases.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Database02Icon} />
            </EmptyMedia>
            <EmptyTitle>No databases yet</EmptyTitle>
            <EmptyDescription>
              Provision Postgres, Redis, MariaDB, MongoDB and more from any project's deploy wizard.
              They'll all show up here.
            </EmptyDescription>
          </EmptyHeader>
          <AddDatabaseMenu orgSlug={orgSlug} />
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No databases match this filter.</p>
          )}
          {filtered.map((db) => (
            <DatabaseCard key={db.resourceId} db={db} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </Page>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

/**
 * "Add database" = pick a project, land in its deploy wizard. The wizard is a
 * project-scoped dialog with no database-only entry point; `?new=service`
 * (the GitHub-connect return path's param) opens it on the kind picker where
 * Database is one of the tiles — the most direct honest flow from an
 * org-level page.
 */
function AddDatabaseMenu({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const { data: projects } = useQuery(orpc.project.list.queryOptions());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" className="gap-1.5" />}>
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
        Add database
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Add to project…</DropdownMenuLabel>
        {(projects ?? []).map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() =>
              // Plain history push so the untyped `?new=service` param survives
              // (it's read from raw location search by the wizard overlay).
              router.history.push(`/${orgSlug}/${p.slug}/graph?new=service`)
            }
          >
            <span className="truncate">{p.name}</span>
            <span className="ml-auto pl-3 font-mono text-[10px] text-muted-foreground">
              {p.slug}
            </span>
          </DropdownMenuItem>
        ))}
        {projects?.length === 0 && (
          <DropdownMenuItem disabled>No projects yet — create one first</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CardSkeletons() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-6 w-20 rounded-md" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 border-t pt-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
      ))}
    </div>
  );
}
