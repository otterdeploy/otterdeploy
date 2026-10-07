/** The Schedules and Destinations views. Titles and the primary action live in
 *  the page header, once. */
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import type { Destination } from "./data/destinations";
import type { Schedule } from "./data/schedules";

import { DestinationRow } from "./destination-row";
import { ScheduleCard } from "./schedule-card";

export function SchedulesSection({
  schedules,
  onEdit,
}: {
  schedules: Schedule[];
  onEdit: (s: Schedule) => void;
}) {
  return (
    <>
      {/* No section title or second "New schedule": the page header already
          names this view and carries its one primary action. */}
      {schedules.length === 0 ? (
        <Empty className="mb-8 rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Clock01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No schedules yet</EmptyTitle>
            <EmptyDescription>
              New schedule, above, backs up on a recurring cadence.
            </EmptyDescription>
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
  onEdit,
}: {
  destinations: Destination[];
  onEdit: (d: Destination) => void;
}) {
  return (
    <>
      {/* One title and one primary action per view: the page header has both. */}
      <div className="mb-10 overflow-hidden rounded-md border bg-card">
        {destinations.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No destinations yet. Add destination, above, to start storing backups.
          </div>
        ) : (
          // Real destinations first, connected buckets after. Both belong in
          // this list — it is where you come to opt a bucket in — but the
          // things backups are actually written to should be read first.
          [...destinations]
            .sort((a, b) => Number(b.usedForBackups) - Number(a.usedForBackups))
            .map((d, i) => (
              <DestinationRow
                key={d.id}
                dest={d}
                first={i === 0}
                // Live-query rows carry `$synced`: false while a create or
                // edit is still on its way to the server.
                pending={"$synced" in d && d.$synced === false}
                onEdit={() => onEdit(d)}
              />
            ))
        )}
      </div>
    </>
  );
}
