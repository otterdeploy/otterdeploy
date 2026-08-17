/**
 * Coverage: every database in the org with its PROTECTION status, the view
 * that answers "is everything that matters actually backed up?". Builds on
 * the live catalog rows (engine, size, connections, last backup) and overlays
 * schedule membership:
 *
 *   protected   — at least one enabled schedule covers it (by id or name)
 *   unprotected — dumpable engine with no schedule: the actionable warning
 *   volume-only — redis-family engines (no logical dump; point at its volume)
 *   unsupported — clickhouse (no backup path yet; honest, not a silent skip)
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { Link } from "@tanstack/react-router";

import type { CatalogDatabase } from "@/features/databases/data";

import { useDatabaseCatalog } from "@/features/databases/data";
import { fmtBytes, relTime } from "@/features/databases/shared";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

import type { Schedule } from "./data/schedules";

import { SectionH } from "./shared";

type Protection =
  | { kind: "protected"; schedules: Schedule[] }
  | { kind: "unprotected" }
  | { kind: "volume-only" }
  | { kind: "unsupported" };

/** Pure classifier so the row rendering stays declarative. */
export function classifyProtection(db: CatalogDatabase, schedules: Schedule[]): Protection {
  if (db.engine === "redis") return { kind: "volume-only" };
  if (db.engine === "clickhouse") return { kind: "unsupported" };
  const covering = schedules.filter(
    (s) => s.enabled && (s.sources.includes(db.resourceId) || s.sources.includes(db.name)),
  );
  return covering.length > 0 ? { kind: "protected", schedules: covering } : { kind: "unprotected" };
}

function ProtectionBadge({ p }: { p: Protection }) {
  switch (p.kind) {
    case "protected":
      return (
        <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 font-mono text-[10px] text-success">
          <span className="size-1.5 rounded-full bg-current" />
          {p.schedules.length === 1 ? "protected" : `protected ×${p.schedules.length}`}
        </Badge>
      );
    case "unprotected":
      return (
        <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 font-mono text-[10px] text-warning">
          <span className="size-1.5 rounded-full bg-current" />
          not scheduled
        </Badge>
      );
    case "volume-only":
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[10px] text-muted-foreground">
          volume backup
        </Badge>
      );
    case "unsupported":
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[10px] text-muted-foreground">
          not supported yet
        </Badge>
      );
  }
}

export function CoverageSection({
  orgSlug,
  schedules,
  onCreateSchedule,
  onBackupNow,
}: {
  orgSlug: string;
  schedules: Schedule[];
  /** Open the schedule editor with this database pre-seeded as the source. */
  onCreateSchedule: (resourceId: ResourceId) => void;
  onBackupNow: () => void;
}) {
  const { data, isPending, isError, refetch } = useDatabaseCatalog();
  const databases = data?.databases ?? [];
  const unprotected = databases.filter(
    (db) => classifyProtection(db, schedules).kind === "unprotected",
  ).length;

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <SectionH
          title="Coverage"
          sub="Every database in the org and whether a schedule protects it"
        />
        <div className="flex-1" />
        {unprotected > 0 && (
          <span className="font-mono text-[11px] text-warning">
            {unprotected} unprotected
          </span>
        )}
      </div>

      {isPending ? (
        <div className="mb-8 flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <div className="mb-8 overflow-hidden rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Couldn't load database stats.{" "}
          <button
            type="button"
            className="text-foreground underline-offset-2 hover:underline"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      ) : databases.length === 0 ? (
        <div className="mb-8 overflow-hidden rounded-md border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          No databases yet. Provision one from any project's deploy wizard.
        </div>
      ) : (
        <div className="mb-8 overflow-hidden rounded-md border bg-card">
          {databases.map((db, i) => (
            <CoverageRow
              key={db.resourceId}
              db={db}
              orgSlug={orgSlug}
              first={i === 0}
              protection={classifyProtection(db, schedules)}
              onCreateSchedule={onCreateSchedule}
              onBackupNow={onBackupNow}
            />
          ))}
        </div>
      )}
    </>
  );
}

function CoverageRow({
  db,
  orgSlug,
  first,
  protection,
  onCreateSchedule,
  onBackupNow,
}: {
  db: CatalogDatabase;
  orgSlug: string;
  first: boolean;
  protection: Protection;
  onCreateSchedule: (resourceId: ResourceId) => void;
  onBackupNow: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20",
        !first && "border-t",
      )}
    >
      <Link
        to="/$orgSlug/$projectSlug/graph/$resourceId"
        params={{
          orgSlug,
          projectSlug: zSlug(ID_PREFIX.project).parse(db.projectSlug),
          resourceId: db.resourceId,
        }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background">
          <DatabaseLogo value={db.engine} size={16} />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm font-medium">{db.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {db.projectSlug}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{db.engineLabel}</span>
            <span>·</span>
            <span>{fmtBytes(db.stats?.sizeBytes ?? null)}</span>
          </div>
        </div>
      </Link>

      <div className="hidden min-w-28 flex-col items-end sm:flex">
        <span className="font-mono text-xs">{relTime(db.lastBackupAt)}</span>
        <span className="text-[10px] text-muted-foreground">Last backup</span>
      </div>

      <ProtectionBadge p={protection} />

      {protection.kind === "unprotected" && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onCreateSchedule(db.resourceId)}
        >
          Create schedule
        </Button>
      )}
      {protection.kind === "volume-only" && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onBackupNow}>
          Back up its volume
        </Button>
      )}
    </div>
  );
}
