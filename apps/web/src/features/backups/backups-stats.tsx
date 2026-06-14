/** Summary tiles above the runs table. */
import { cn } from "@/shared/lib/utils";

import type { Backup } from "./data/backups";
import { fmtBytes } from "./shared";

export function BackupsStats({
  total,
  matchCount,
  storedBytes,
  lastSuccess,
  lastFail,
}: {
  total: number;
  matchCount: number;
  storedBytes: number;
  lastSuccess: Backup | undefined;
  lastFail: Backup | undefined;
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Total backups"
        value={String(total)}
        sub={`${matchCount} match filters`}
      />
      <Stat
        label="Stored size"
        value={fmtBytes(storedBytes)}
        sub="across all destinations"
      />
      <Stat
        label="Last successful"
        value={lastSuccess ? "✓" : "—"}
        sub={lastSuccess?.source ?? "no successful backup"}
      />
      <Stat
        label="Last failed"
        value={lastFail ? "!" : "none"}
        sub={lastFail?.source ?? "no recent failures"}
        tone={lastFail ? "warn" : undefined}
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
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tracking-tight",
          tone === "warn" && "font-mono text-amber-500",
        )}
      >
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
