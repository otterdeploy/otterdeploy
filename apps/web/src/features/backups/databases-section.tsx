/**
 * Databases — one row per database resource across the org's projects, with
 * live connections + data-size stats. Moved here from the standalone
 * Databases catalog page (od-u63.6, superseding od-asc.3's "no third
 * database inventory" decision) — Backups already reads per-database backup
 * freshness, so the live runtime stats belong on the same page instead of a
 * separate route. Data + formatters are reused as-is from features/databases/
 * (same polled catalog query, same "—" degrade-when-unmeasured rule).
 */
import type { ProjectSlug, ResourceId } from "@otterdeploy/shared/id";

import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { CatalogDatabase } from "@/features/databases/data";

import {
  ConnectionsPopoverBody,
  useDbConnections,
} from "@/features/databases/connections-popover";
import { useDatabaseCatalog } from "@/features/databases/data";
import { fmtBytes, relTime, StatusPill } from "@/features/databases/shared";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { SectionH } from "./shared";

export function DatabasesSection({ orgSlug }: { orgSlug: string }) {
  const { data, isPending, isError, refetch } = useDatabaseCatalog();
  const databases = data?.databases ?? [];

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <SectionH
          title="Databases"
          sub="Live connections and data size across every database in the org"
        />
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
            <DatabaseStatsRow key={db.resourceId} db={db} orgSlug={orgSlug} first={i === 0} />
          ))}
        </div>
      )}
    </>
  );
}

function DatabaseStatsRow({
  db,
  orgSlug,
  first,
}: {
  db: CatalogDatabase;
  orgSlug: string;
  first: boolean;
}) {
  const version = db.stats?.serverVersion ?? db.version;

  return (
    <Link
      to="/$orgSlug/$projectSlug/graph/$resourceId"
      params={{
        orgSlug,
        projectSlug: db.projectSlug as ProjectSlug,
        resourceId: db.resourceId,
      }}
      className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30 ${
        first ? "" : "border-t"
      }`}
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background">
        <DatabaseLogo value={db.engine} size={16} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">{db.name}</span>
          {version && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {version}
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {db.projectSlug}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{db.engineLabel}</div>
      </div>

      <Stat label="Storage" value={fmtBytes(db.stats?.sizeBytes ?? null)} />
      {db.engine === "postgres" && db.stats?.connections != null ? (
        <ConnectionsStat resourceId={db.resourceId} count={db.stats.connections} />
      ) : (
        <Stat
          label="Connections"
          value={db.stats?.connections != null ? String(db.stats.connections) : "—"}
        />
      )}
      <Stat label="Last backup" value={relTime(db.lastBackupAt)} />

      <StatusPill status={db.runtimeStatus} />
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden min-w-24 flex-col items-end gap-0 sm:flex">
      <span className="font-mono text-xs">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * The connections number, expandable into a who-is-connected breakdown
 * (shared body — see features/databases/connections-popover). Fetched only
 * when opened — the row itself never pays for it. Lives inside the row's
 * <Link>, so the trigger must swallow the click instead of navigating.
 */
function ConnectionsStat({ resourceId, count }: { resourceId: ResourceId; count: number }) {
  const [open, setOpen] = useState(false);
  const breakdown = useDbConnections(resourceId, open);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="hidden min-w-24 cursor-pointer flex-col items-end gap-0 rounded-sm px-1 -mx-1 hover:bg-muted/60 sm:flex"
      >
        <span className="font-mono text-xs underline decoration-dotted underline-offset-2">
          {count}
        </span>
        <span className="text-[10px] text-muted-foreground">Connections</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 p-0"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <ConnectionsPopoverBody query={breakdown} total={count} />
      </PopoverContent>
    </Popover>
  );
}
