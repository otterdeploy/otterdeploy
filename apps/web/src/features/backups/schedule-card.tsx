/**
 * One recurring schedule card: cadence, retention, destination, last/next run,
 * and an enable toggle. Toggle + delete mutate the collection optimistically;
 * edit opens the editor dialog.
 */
import { useState } from "react";

import {
  Alert02Icon,
  Clock01Icon,
  CloudServerIcon,
  Delete02Icon,
  Edit02Icon,
  FlashIcon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result } from "better-result";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

import type { Schedule } from "./data/schedules";

import { runSchedule, schedulesCollection } from "./data/schedules";
import { cronHuman, retentionLabel } from "./labels";
import { StatusBadge, encLabel, relTime } from "./shared";

export function ScheduleCard({ schedule: s, onEdit }: { schedule: Schedule; onEdit: () => void }) {
  const toggle = async (checked: boolean) => {
    const tx = schedulesCollection.update(s.id, (draft) => {
      draft.enabled = checked;
    });
    const persisted = await Result.tryPromise({
      try: () => tx.isPersisted.promise,
      catch: errorFromUnknown,
    });
    if (persisted.isErr()) toast.error(persisted.error.message);
  };

  const remove = async () => {
    const tx = schedulesCollection.delete(s.id);
    const persisted = await Result.tryPromise({
      try: () => tx.isPersisted.promise,
      catch: errorFromUnknown,
    });
    if (persisted.isErr()) toast.error(persisted.error.message);
    else toast.success("Schedule deleted");
  };

  const [running, setRunning] = useState(false);
  const triggerRun = async () => {
    setRunning(true);
    const run = await Result.tryPromise({
      try: () => runSchedule(s.id),
      catch: errorFromUnknown,
    });
    if (run.isErr()) toast.error(run.error.message);
    else if (run.value.queued > 0) {
      toast.success(`Queued ${run.value.queued} backup${run.value.queued === 1 ? "" : "s"}`);
    } else toast.info("No database sources resolved for this schedule");
    setRunning(false);
  };

  const encryption = encLabel(s.encryption);
  const missing = s.missingSources ?? [];
  // Every configured source has lost its backing database. The schedule can't
  // produce a backup until it's repaired (source re-pointed) or deleted.
  const orphaned = missing.length > 0 && missing.length >= s.sources.length;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-card p-4",
        missing.length > 0 && "border-warning/40 bg-warning/[0.03]",
      )}
    >
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Clock01Icon} className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{s.name}</span>
        {missing.length > 0 && <SourceHealthBadge orphaned={orphaned} />}
        <div className="flex-1" />
        <Switch checked={s.enabled} onCheckedChange={toggle} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {s.sources.length} source{s.sources.length === 1 ? "" : "s"} ·{" "}
        <span className="font-mono">{s.sources.slice(0, 3).join(", ")}</span>
        {s.sources.length > 3 && <span> +{s.sources.length - 3}</span>}
      </p>

      {missing.length > 0 && <MissingSourceBanner missing={missing} />}

      <div className="rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="font-mono text-xs">{s.cron}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{cronHuman(s.cron)}</div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
              {s.destinationNames.length ? s.destinationNames.join(", ") : "–"}
            </span>
          </span>
        </div>
      </div>

      <ScheduleRunFooter schedule={s} encryption={encryption} />

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

/** Last/next run + the policy badges (auto-verify, retry, encryption). */
function ScheduleRunFooter({
  schedule: s,
  encryption,
}: {
  schedule: Schedule;
  encryption: string;
}) {
  return (
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
      {s.verifyAfterBackup && (
        <Badge
          variant="outline"
          className="gap-1 border-success/30 bg-success/10 font-mono text-[10px] text-success"
          title="Each successful run is restore-verified in a sandbox"
        >
          auto-verify
        </Badge>
      )}
      {s.maxRetries > 0 && (
        <Badge variant="secondary" className="font-mono text-[10px]" title="Failed runs retry">
          retry ×{s.maxRetries}
        </Badge>
      )}
      {s.encryption !== "none" && (
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <HugeiconsIcon icon={SquareLock01Icon} className="size-2.5" />
          {encryption}
        </Badge>
      )}
    </div>
  );
}

/** Header pill flagging a schedule whose source(s) have partly or fully lost
 *  their backing database. */
function SourceHealthBadge({ orphaned }: { orphaned: boolean }) {
  return (
    <Badge
      variant="secondary"
      className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning"
    >
      <HugeiconsIcon icon={Alert02Icon} className="size-2.5" />
      {orphaned ? "Source missing" : "Source degraded"}
    </Badge>
  );
}

/** Explains the orphaned state and names the dead refs: the honest "something
 *  is wrong here" the card was missing when a backed-up database is deleted. */
function MissingSourceBanner({ missing }: { missing: string[] }) {
  const many = missing.length > 1;
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.06] px-2.5 py-2 text-[11px] text-warning">
      <HugeiconsIcon icon={Alert02Icon} className="mt-px size-3.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          {many ? "Backup sources no longer exist" : "Backup source no longer exists"}
        </span>
        <span className="text-warning/80">
          The database this schedule backs up was deleted, so runs produce nothing. Repair the
          source in Edit, or delete the schedule.
        </span>
        <span className="mt-0.5 font-mono text-[10px] text-warning/70">
          {missing.slice(0, 3).join(", ")}
          {missing.length > 3 && ` +${missing.length - 3}`}
        </span>
      </div>
    </div>
  );
}
