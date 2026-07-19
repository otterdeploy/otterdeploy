/**
 * Backups — database dumps, schedules, and storage destinations for the active
 * org. Reads three TanStack DB collections via live queries and renders them;
 * all mutation lives on the collections (or the run/restore actions). Filtering
 * stays client-side over the full list.
 */
import { useState } from "react";
import { Clock01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";

import type { Backup } from "@/features/backups/data/backups";
import { backupsCollection } from "@/features/backups/data/backups";
import type { Destination } from "@/features/backups/data/destinations";
import { destinationsCollection } from "@/features/backups/data/destinations";
import type { Schedule } from "@/features/backups/data/schedules";
import { schedulesCollection } from "@/features/backups/data/schedules";
import { BackupNowDialog } from "@/features/backups/backup-now-dialog";
import { BackupsFilters } from "@/features/backups/backups-filters";
import {
  DestinationsSection,
  SchedulesSection,
} from "@/features/backups/backups-sections";
import { BackupsStats } from "@/features/backups/backups-stats";
import { BackupsTable } from "@/features/backups/backups-table";
import { DestinationEditorDialog } from "@/features/backups/destination-editor-dialog";
import { RestoreWizard } from "@/features/backups/restore-wizard";
import { ScheduleEditorDialog } from "@/features/backups/schedule-editor-dialog";
import { ALL_PROJECTS, type BackupKind } from "@/features/backups/shared";

export const Route = createFileRoute("/_app/$orgSlug/_shell/backups")({
  staticData: { crumb: "Backups" },
  component: BackupsRoute,
});

function BackupsRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const organizationId = organization.id;

  const { data: backups } = useLiveQuery((q) =>
    q.from({ b: backupsCollection }),
  );
  const { data: schedules } = useLiveQuery((q) =>
    q.from({ s: schedulesCollection }),
  );
  const { data: destinations } = useLiveQuery((q) =>
    q.from({ d: destinationsCollection }),
  );

  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [kindFilter, setKindFilter] = useState<"all" | BackupKind>("all");
  const [destFilter, setDestFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [backupNowOpen, setBackupNowOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<Schedule | "new" | null>(
    null,
  );
  const [destEditor, setDestEditor] = useState<Destination | "new" | null>(null);
  const [restoreFor, setRestoreFor] = useState<Backup | null>(null);

  const projects = Array.from(
    new Set(backups.map((b) => b.project).filter((p): p is string => !!p)),
  ).sort();

  const projectCounts: Record<string, number> = {};
  for (const id of projects)
    projectCounts[id] = backups.filter((b) => b.project === id).length;

  const q = search.trim().toLowerCase();
  const filtered = backups.filter((b) => {
    if (projectFilter !== ALL_PROJECTS && b.project !== projectFilter)
      return false;
    if (kindFilter !== "all" && b.kind !== kindFilter) return false;
    if (destFilter !== "all" && b.destinationId !== destFilter) return false;
    if (
      q &&
      !(b.source ?? b.volumeName ?? b.resourceId ?? "").toLowerCase().includes(q) &&
      !b.id.toLowerCase().includes(q) &&
      !(b.sourceHost ?? "").toLowerCase().includes(q)
    )
      return false;
    return true;
  });

  const storedBytes = backups
    .filter((b) => b.status === "succeeded")
    .reduce((acc, b) => acc + (b.compressedSizeBytes ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Backups"
        description="Database dumps & volume archives · recurring schedules · storage destinations"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setScheduleEditor("new")}
            >
              <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
              Schedule
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setBackupNowOpen(true)}
            >
              <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
              Backup now
            </Button>
          </>
        }
      />

      <BackupsStats
        total={backups.length}
        matchCount={filtered.length}
        storedBytes={storedBytes}
        lastSuccess={backups.find((b) => b.status === "succeeded")}
        lastFail={backups.find((b) => b.status === "failed")}
      />

      <BackupsFilters
        projects={projects}
        projectCounts={projectCounts}
        projectFilter={projectFilter}
        onProjectFilter={setProjectFilter}
        kindFilter={kindFilter}
        onKindFilter={setKindFilter}
        destFilter={destFilter}
        onDestFilter={setDestFilter}
        destinations={destinations}
        search={search}
        onSearch={setSearch}
      />

      <BackupsTable
        backups={filtered}
        total={backups.length}
        onRestore={setRestoreFor}
      />

      <SchedulesSection
        schedules={schedules}
        onNew={() => setScheduleEditor("new")}
        onEdit={setScheduleEditor}
      />

      <DestinationsSection
        destinations={destinations}
        onAdd={() => setDestEditor("new")}
        onEdit={setDestEditor}
      />

      <BackupNowDialog
        open={backupNowOpen}
        onOpenChange={setBackupNowOpen}
        destinations={destinations}
        onAddDestination={() => {
          setBackupNowOpen(false);
          setDestEditor("new");
        }}
      />
      <ScheduleEditorDialog
        initial={scheduleEditor === "new" ? null : scheduleEditor}
        organizationId={organizationId}
        open={scheduleEditor !== null}
        onOpenChange={(o) => !o && setScheduleEditor(null)}
        destinations={destinations}
      />
      <DestinationEditorDialog
        initial={destEditor === "new" ? null : destEditor}
        organizationId={organizationId}
        open={destEditor !== null}
        onOpenChange={(o) => !o && setDestEditor(null)}
      />
      <RestoreWizard
        backup={restoreFor}
        open={restoreFor !== null}
        onOpenChange={(o) => !o && setRestoreFor(null)}
      />
    </Page>
  );
}
