/**
 * Summary tiles above the volumes table. Only measured numbers: the `local`
 * driver has no provisioned/quota size, so there is no "provisioned" tile —
 * "On disk" sums what `docker system df` actually reports and says how many
 * volumes went unmeasured instead of pretending they're zero bytes.
 */
import { cn } from "@/shared/lib/utils";

import type { VolumeRow } from "./shared";

import { fmtBytes } from "./shared";

export function VolumesStats({ volumes }: { volumes: VolumeRow[] }) {
  const measured = volumes.filter((v) => v.sizeBytes >= 0);
  const unmeasured = volumes.length - measured.length;
  const onDisk = measured.reduce((s, v) => s + v.sizeBytes, 0);
  const inUse = volumes.filter((v) => v.refCount > 0).length;
  const orphans = volumes.filter((v) => v.orphan).length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Total volumes" value={String(volumes.length)} sub="on this daemon" />
      <Stat
        label="On disk"
        value={measured.length > 0 ? fmtBytes(onDisk) : "—"}
        sub={
          unmeasured > 0
            ? `${unmeasured} volume${unmeasured === 1 ? "" : "s"} not measured`
            : "measured by the daemon"
        }
      />
      <Stat
        label="In use"
        value={String(inUse)}
        sub={`mounted by ${inUse === 1 ? "a container" : "containers"}`}
      />
      <Stat
        label="Orphans"
        value={String(orphans)}
        sub={orphans > 0 ? "unreferenced and unclaimed" : "none detected"}
        tone={orphans > 0 ? "warn" : undefined}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "warn";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3.5">
      <div className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tracking-tight",
          tone === "warn" && "text-amber-600 dark:text-amber-500",
        )}
      >
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
