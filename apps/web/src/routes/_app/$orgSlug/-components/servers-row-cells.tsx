/**
 * Role / status badges for a server: shared by the fleet cards and the
 * per-server health sheet.
 */
import { type Server } from "@/features/servers/data/server";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

export function RoleBadge({ role, leader }: { role: Server["role"]; leader: boolean }) {
  const tone =
    role === "manager"
      ? "border-info/30 bg-info/10 text-info"
      : "border-border bg-muted text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={cn("h-5 px-1.5 font-mono text-[10px] font-medium", tone)}>
        {role}
      </Badge>
      {leader && (
        <Badge
          variant="outline"
          className="h-5 border-success/30 bg-success/10 px-1.5 font-mono text-[10px] font-medium text-success"
        >
          leader
        </Badge>
      )}
    </span>
  );
}

export function StatusBadge({
  status,
  availability,
}: {
  status: Server["status"];
  availability: Server["availability"];
}) {
  const tone =
    status === "ready" && availability === "active"
      ? "bg-success/15 text-success border-success/30"
      : status === "draining" || availability === "drain"
        ? "bg-warning/15 text-warning border-warning/30"
        : status === "down"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-muted text-muted-foreground border-border";
  const label =
    availability === "drain" ? "draining" : availability === "pause" ? "paused" : status;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium",
        tone,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "ready" && availability === "active"
            ? "bg-success"
            : status === "down"
              ? "bg-destructive"
              : "bg-warning",
        )}
      />
      {label}
    </span>
  );
}
