/**
 * Per-server health detail — the read-only snapshot a Servers row opens.
 * Renders whatever the node's reporter last delivered (local sampler or the
 * swarm health agent); reclaim/grow actions deliberately live only on the
 * "Host health" card, which executes against the local docker socket —
 * offering those buttons for a remote node would claim an ability the
 * control plane doesn't have yet (docs/designs/server-health-agent.md,
 * remote reclaim = phase 2).
 */
import { type Server } from "@/features/servers/data/server";
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { Badge } from "@/shared/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

import { fmtBytes, UsageRow } from "./servers-health-pool";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "text-destructive ring-destructive/30",
  warning: "text-amber-600 ring-amber-500/30 dark:text-amber-500",
  info: "text-muted-foreground ring-border",
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function ServerHealthSheet({
  server,
  entry,
  onOpenChange,
}: {
  server: Server | null;
  entry: ServerHealthEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const health = entry?.health ?? null;
  return (
    <Sheet open={server !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono text-[14px]">
            {server?.name}
            {entry?.stale && (
              <Badge
                variant="outline"
                className="h-4.5 border-warning/30 bg-warning/10 px-1.5 font-mono text-[10px] font-medium text-warning"
              >
                stale
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {entry
              ? `Reported ${relativeTime(entry.receivedAt)} by ${entry.hostname ?? "unknown host"}.`
              : "No health report from this server yet — remote nodes report once the health agent reaches them."}
          </SheetDescription>
        </SheetHeader>

        {health && (
          <div className="flex flex-col gap-4 px-4 pb-6">
            <UsageRow
              label="Memory"
              value={health.memory.usedPct}
              detail={`${fmtBytes(health.memory.totalBytes - health.memory.availableBytes)} / ${fmtBytes(health.memory.totalBytes)} · ${health.memory.usedPct}%${health.memory.swapTotalBytes === 0 ? " · no swap" : ""}`}
            />
            {health.disk && (
              <UsageRow
                label={`Disk (${health.disk.path})`}
                value={health.disk.usedPct}
                detail={`${fmtBytes(health.disk.freeBytes)} free / ${fmtBytes(health.disk.totalBytes)} · ${health.disk.usedPct}%`}
              />
            )}

            {health.docker ? (
              <div className="flex flex-col divide-y divide-border/60 rounded-md ring-1 ring-foreground/10">
                {(
                  [
                    ["Images", health.docker.images],
                    ["Containers", health.docker.containers],
                    ["Volumes", health.docker.volumes],
                    ["Build cache", health.docker.buildCache],
                  ] as const
                ).map(([label, section]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-[12.5px]">{label}</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                      {section.count} · {fmtBytes(section.totalBytes)}
                      {section.reclaimableBytes > 0 &&
                        ` (${fmtBytes(section.reclaimableBytes)} reclaimable)`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12.5px] text-muted-foreground">
                Docker disk usage unavailable.
              </div>
            )}

            {health.recommendations.length > 0 && (
              <div className="flex flex-col gap-2">
                {health.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className={`flex flex-col gap-1 rounded-md p-3 ring-1 ${SEVERITY_STYLES[rec.severity] ?? SEVERITY_STYLES.info}`}
                  >
                    <span className="text-[12.5px] font-medium">{rec.title}</span>
                    <span className="text-[11.5px] text-muted-foreground">{rec.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
