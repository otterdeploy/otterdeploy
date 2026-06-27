/** The Schedules and Destinations list sections below the runs table. */
import { Clock01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import type { Destination } from "./data/destinations";
import type { Schedule } from "./data/schedules";

import { DestinationRow } from "./destination-row";
import { ScheduleCard } from "./schedule-card";
import { SectionH } from "./shared";

export function SchedulesSection({
  schedules,
  onNew,
  onEdit,
}: {
  schedules: Schedule[];
  onNew: () => void;
  onEdit: (s: Schedule) => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <SectionH title="Schedules" sub="Recurring backup pipelines" />
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onNew}>
          <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
          New schedule
        </Button>
      </div>
      {schedules.length === 0 ? (
        <Empty className="mb-8 rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Clock01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No schedules yet</EmptyTitle>
            <EmptyDescription>Create one to back up on a recurring cadence.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {schedules.map((s) => (
            <ScheduleCard key={s.id} schedule={s} onEdit={() => onEdit(s)} />
          ))}
        </div>
      )}
    </>
  );
}

export function DestinationsSection({
  destinations,
  onAdd,
  onEdit,
}: {
  destinations: Destination[];
  onAdd: () => void;
  onEdit: (d: Destination) => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <SectionH title="Destinations" sub="Where backups are written" />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onAdd}>
          <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
          Add destination
        </Button>
      </div>
      <div className="mb-10 overflow-hidden rounded-md border bg-card">
        {destinations.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No destinations yet. Add one to start storing backups.
          </div>
        ) : (
          destinations.map((d, i) => (
            <DestinationRow key={d.id} dest={d} first={i === 0} onEdit={() => onEdit(d)} />
          ))
        )}
      </div>
    </>
  );
}
