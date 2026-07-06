/**
 * Live memory/disk utilization from a node's last health report — the honest
 * counterpart to the allocation bars (reserved ≠ used). "—" until a report
 * lands; a warning dot when the reporter has gone quiet (stale). Fed by
 * server.health (docs/designs/server-health-agent.md).
 */
import { type ServerHealthEntry } from "@/features/servers/data/health";

export function LiveHealthCell({ health }: { health: ServerHealthEntry | null }) {
  if (!health?.health) {
    return <span className="font-mono text-[11px] text-muted-foreground/40">—</span>;
  }
  const mem = health.health.memory.usedPct;
  const disk = health.health.disk?.usedPct ?? null;
  const tone = (pct: number) =>
    pct >= 90 ? "text-destructive" : pct >= 75 ? "text-warning" : "text-foreground";
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
      <span>
        <span className="text-muted-foreground">mem </span>
        <span className={tone(mem)}>{mem}%</span>
      </span>
      {disk !== null && (
        <span>
          <span className="text-muted-foreground">disk </span>
          <span className={tone(disk)}>{disk}%</span>
        </span>
      )}
      {health.stale && (
        <span
          className="size-1.5 rounded-full bg-warning"
          title="Last report is stale — the node's health agent has gone quiet."
        />
      )}
    </div>
  );
}
