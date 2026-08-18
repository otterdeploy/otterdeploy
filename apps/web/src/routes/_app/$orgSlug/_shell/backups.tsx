/**
 * Backups, restructured into four views so "what am I doing here" is always
 * one glance away (od-6et):
 *
 *   Activity    : run history + stats + filters; the "what happened" surface
 *                  and the home of one-shot "Backup now".
 *   Coverage    : every database and whether a schedule protects it; the
 *                  "is everything backed up?" surface.
 *   Schedules   : the recurring pipelines (cadence, retention, verification).
 *   Destinations: where snapshots are stored.
 *
 * The view rides a `?view=` search param so each surface is linkable. Reads
 * come from the three TanStack DB collections via live queries; all mutation
 * lives on the collections (or the run/restore actions).
 */
import { useState } from "react";
import { Clock01Icon, PlusSignIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import * as z from "zod";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

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
import { CoverageSection } from "@/features/backups/coverage-section";
import { DestinationEditorDialog } from "@/features/backups/destination-editor-dialog";
import { RestoreWizard } from "@/features/backups/restore-wizard";
import { ScheduleEditorDialog } from "@/features/backups/schedule-editor-dialog";
import { ALL_PROJECTS, type BackupKind } from "@/features/backups/shared";

const VIEWS = [
  { id: "activity", label: "Activity" },
  { id: "coverage", label: "Coverage" },
  { id: "schedules", label: "Schedules" },
  { id: "destinations", label: "Destinations" },
] as const;

type View = (typeof VIEWS)[number]["id"];

const searchSchema = z.object({
  view: z.enum(["activity", "coverage", "schedules", "destinations"]).catch("activity").default("activity"),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/backups")({
  staticData: { crumb: "Backups" },
  component: BackupsRoute,
  validateSearch: searchSchema,
  // Warm the three eager collections on hover (intent-preload) so the page
  // renders from cache instead of spinning. Non-blocking + idempotent.
  loader: () => {
    void backupsCollection.preload();
    void schedulesCollection.preload();
    void destinationsCollection.preload();
  },
});

function ViewTabs({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div className="mb-5 flex items-center gap-1 border-b">
      {VIEWS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onView(t.id)}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
            view === t.id
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function BackupsRoute() {
  const { orgSlug } = Route.useParams();
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const organizationId = organization.id;

  const { data: backups } = useLiveQuery((q) => q.from({ b: backupsCollection }));
  const { data: schedules } = useLiveQuery((q) => q.from({ s: schedulesCollection }));
  const { data: destinations } = useLiveQuery((q) => q.from({ d: destinationsCollection }));

  const [backupNowOpen, setBackupNowOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<Schedule | "new" | null>(null);
  const [presetSources, setPresetSources] = useState<string[]>([]);
  const [destEditor, setDestEditor] = useState<Destination | "new" | null>(null);
  const [restoreFor, setRestoreFor] = useState<Backup | null>(null);

  const setView = (v: View) => void navigate({ search: { view: v }, replace: true });
  const openNewSchedule = (sources: string[] = []) => {
    setPresetSources(sources);
    setScheduleEditor("new");
  };

  // Contextual primary actions: each view offers the action it's about, so
  // "Schedule" no longer sits next to "Backup now" pretending to be the same
  // kind of thing.
  const actions =
    view === "schedules" ? (
      <Button size="sm" className="gap-1.5" onClick={() => openNewSchedule()}>
        <HugeiconsIcon icon={Clock01Icon} className="size-3.5" />
        New schedule
      </Button>
    ) : view === "destinations" ? (
      <Button size="sm" className="gap-1.5" onClick={() => setDestEditor("new")}>
        <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
        Add destination
      </Button>
    ) : (
      <Button size="sm" className="gap-1.5" onClick={() => setBackupNowOpen(true)}>
        <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
        Backup now
      </Button>
    );

  const description =
    view === "activity"
      ? "Every backup run, manual and scheduled, newest first"
      : view === "coverage"
        ? "Which databases are protected, and which are not"
        : view === "schedules"
          ? "Recurring pipelines: cadence, retention, verification"
          : "Where snapshots are stored";

  return (
    <Page>
      <PageHeader title="Backups" description={description} actions={actions} />
      <ViewTabs view={view} onView={setView} />

      {view === "activity" && (
        <ActivityView backups={backups} destinations={destinations} onRestore={setRestoreFor} />
      )}

      {view === "coverage" && (
        <CoverageSection
          orgSlug={orgSlug}
          schedules={schedules}
          onCreateSchedule={(resourceId) => openNewSchedule([resourceId])}
          onBackupNow={() => setBackupNowOpen(true)}
        />
      )}

      {view === "schedules" && (
        <SchedulesSection
          schedules={schedules}
          onNew={() => openNewSchedule()}
          onEdit={setScheduleEditor}
        />
      )}

      {view === "destinations" && (
        <DestinationsSection
          destinations={destinations}
          onAdd={() => setDestEditor("new")}
          onEdit={setDestEditor}
        />
      )}

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
        onOpenChange={(o) => {
          if (!o) {
            setScheduleEditor(null);
            setPresetSources([]);
          }
        }}
        destinations={destinations}
        presetSources={presetSources}
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

/** The runs surface: stats, filter toolbar, and the table. */
function ActivityView({
  backups,
  destinations,
  onRestore,
}: {
  backups: Backup[];
  destinations: Destination[];
  onRestore: (b: Backup) => void;
}) {
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [kindFilter, setKindFilter] = useState<"all" | BackupKind>("all");
  const [destFilter, setDestFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const projects = Array.from(
    new Set(backups.map((b) => b.project).filter((p): p is string => !!p)),
  ).sort();

  const projectCounts: Record<string, number> = {};
  for (const id of projects)
    projectCounts[id] = backups.filter((b) => b.project === id).length;

  const q = search.trim().toLowerCase();
  const filtered = backups.filter((b) => {
    if (projectFilter !== ALL_PROJECTS && b.project !== projectFilter) return false;
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
    <>
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
      <BackupsTable backups={filtered} total={backups.length} onRestore={onRestore} />
    </>
  );
}
