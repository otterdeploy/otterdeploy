/**
 * Create / edit a recurring backup schedule. Fields mirror the server contract
 * (name, sources, cron, destinations, GFS retention tiers, hooks, encryption,
 * enabled). Schedules are database-only by design: the scheduler resolves
 * `sources` against database resources, so volumes are backed up via the
 * one-shot "Backup now" flow, not invented here as schedulable. Destination
 * and encryption are fixed after creation (the update input can't change
 * them). The form plumbing + field layout live in `./schedule-fields`.
 */
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";

import type { Destination } from "./data/destinations";
import type { Schedule } from "./data/schedules";

import { ScheduleFields } from "./schedule-fields";
import { useScheduleForm } from "./schedule-form";

export function ScheduleEditorDialog({
  initial,
  organizationId,
  open,
  onOpenChange,
  destinations,
}: {
  initial: Schedule | null;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ScheduleEditorBody
        key={initial?.id ?? "new"}
        initial={initial}
        organizationId={organizationId}
        onClose={() => onOpenChange(false)}
        destinations={destinations}
      />
    </Dialog>
  );
}

function ScheduleEditorBody({
  initial,
  organizationId,
  onClose,
  destinations,
}: {
  initial: Schedule | null;
  organizationId: string;
  onClose: () => void;
  destinations: Destination[];
}) {
  const editing = initial !== null;
  const form = useScheduleForm({ initial, organizationId, destinations, onClose });

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="text-sm font-semibold">
          {editing ? `Edit schedule · ${initial.name}` : "New backup schedule"}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          Cron-driven pipeline that runs even when the dashboard is closed.
        </p>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        noValidate
      >
        <ScheduleFields form={form} editing={editing} destinations={destinations} />

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <form.Subscribe
            selector={(s) => [s.values.name, s.values.destinationIds.length] as const}
          >
            {([name, destCount]) => (
              <Button
                size="sm"
                type="submit"
                className="gap-1.5"
                disabled={!name.trim() || destCount === 0}
              >
                <HugeiconsIcon icon={Tick02Icon} className="size-3" />
                Save schedule
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </DialogContent>
  );
}
