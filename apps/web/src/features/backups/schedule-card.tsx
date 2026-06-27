/**
 * One recurring schedule card: cadence, retention, destination, last/next run,
 * and an enable toggle. Toggle + delete mutate the collection optimistically;
 * edit opens the editor dialog.
 */
import { useState } from "react";

import {
  Clock01Icon,
  CloudServerIcon,
  Delete02Icon,
  Edit02Icon,
  FlashIcon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";

import type { Schedule } from "./data/schedules";

import { runSchedule, schedulesCollection } from "./data/schedules";
import { StatusBadge, cronHuman, encLabel, relTime, retentionLabel } from "./shared";

export function ScheduleCard({ schedule: s, onEdit }: { schedule: Schedule; onEdit: () => void }) {
  const toggle = (checked: boolean) => {
    const tx = schedulesCollection.update(s.id, (draft) => {
      draft.enabled = checked;
    });
    tx.isPersisted.promise.catch((err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Couldn't update schedule"),
    );
  };

  const remove = () => {
    const tx = schedulesCollection.delete(s.id);
    tx.isPersisted.promise
      .then(() => toast.success("Schedule deleted"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't delete schedule"),
      );
  };

  const [running, setRunning] = useState(false);
  const triggerRun = () => {
    setRunning(true);
    runSchedule(s.id)
      .then((res) =>
        res.queued > 0
          ? toast.success(`Queued ${res.queued} backup${res.queued === 1 ? "" : "s"}`)
          : toast.info("No database sources resolved for this schedule"),
      )
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't run schedule"),
      )
      .finally(() => setRunning(false));
  };

  const encryption = encLabel(s.encryption);

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Clock01Icon} className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{s.name}</span>
        <div className="flex-1" />
        <Switch checked={s.enabled} onCheckedChange={toggle} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {s.sources.length} source{s.sources.length === 1 ? "" : "s"} ·{" "}
        <span className="font-mono">{s.sources.slice(0, 3).join(", ")}</span>
        {s.sources.length > 3 && <span> +{s.sources.length - 3}</span>}
      </p>

      <div className="rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="font-mono text-xs">{s.cron}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{cronHuman(s.cron)}</div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Retention
          </span>
          <span className="text-xs text-foreground/80">{retentionLabel(s)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Destination
          </span>
          <span className="flex items-center gap-1 text-xs text-foreground/80">
            <HugeiconsIcon icon={CloudServerIcon} className="size-3 text-muted-foreground" />
            <span className="truncate font-mono">
              {s.destinationNames.length ? s.destinationNames.join(", ") : "—"}
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-end gap-4 border-t pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Last run
          </span>
          <span className="flex items-center gap-1.5">
            {s.lastRunStatus ? (
              <StatusBadge status={s.lastRunStatus} />
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground">never</span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground">
              {relTime(s.lastRunAt)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Next run
          </span>
          <span className="font-mono text-xs text-foreground/80">
            {s.enabled ? relTime(s.nextRunAt) : "paused"}
          </span>
        </div>
        <div className="flex-1" />
        {s.pitr && (
          <Badge
            variant="outline"
            className="border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-500"
            title="Point-in-time recovery enabled"
          >
            PITR
          </Badge>
        )}
        {s.encryption !== "none" && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <HugeiconsIcon icon={SquareLock01Icon} className="size-2.5" />
            {encryption}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
          <HugeiconsIcon icon={Edit02Icon} className="size-3" />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={running}
          onClick={triggerRun}
        >
          <HugeiconsIcon icon={FlashIcon} className="size-3" />
          {running ? "Running…" : "Run now"}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
          onClick={remove}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}
