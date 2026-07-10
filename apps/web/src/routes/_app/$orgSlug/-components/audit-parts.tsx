import {
  Certificate01Icon,
  ContainerIcon,
  DatabaseRestoreIcon,
  Folder01Icon,
  GlobalIcon,
  HardDriveIcon,
  Key01Icon,
  Layers01Icon,
  PackageIcon,
  RouteIcon,
  ServerStack01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type AuditEvent, type Outcome } from "@/features/audit/data/audit";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { formatNumber } from "@otterdeploy/shared/format";

import { type ActionTone, actionTone } from "./audit-helpers";

/** Dot color per action family — the demo's ACTION_COLORS, translated to the
 *  app's tokens: create=info, destroy=danger, auth/caution=amber, edits and
 *  everything unclassified stay quiet neutrals. */
const TONE_DOT: Record<ActionTone, string> = {
  create: "bg-sky-500",
  destroy: "bg-destructive",
  update: "bg-muted-foreground/70",
  auth: "bg-amber-500",
  caution: "bg-amber-500",
  neutral: "bg-muted-foreground/40",
};

/** Leading color dot for an action — used by the table's action cell and the
 *  drawer header. */
export function ActionDot({ action, className }: { action: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        TONE_DOT[actionTone(action)],
        className,
      )}
    />
  );
}

/** targetType → kind icon (demo's RESOURCE_ICON). Kinds come from the audit
 *  emitters' `target: { type }` values across the API. */
const TARGET_ICONS: Record<string, typeof PackageIcon> = {
  project: Folder01Icon,
  organization: UserGroupIcon,
  resource: PackageIcon,
  server: ServerStack01Icon,
  webhook: WebhookIcon,
  certificate: Certificate01Icon,
  environment: Layers01Icon,
  backup: DatabaseRestoreIcon,
  ip: GlobalIcon,
  platform: Settings01Icon,
  "proxy-route": RouteIcon,
  "docker-image": ContainerIcon,
  "docker-network": ContainerIcon,
  "docker-volume": HardDriveIcon,
  user: UserIcon,
  "api-key": Key01Icon,
};

export function TargetKindIcon({
  targetType,
  className,
}: {
  targetType: string | null;
  className?: string;
}) {
  if (!targetType) return null;
  const icon = TARGET_ICONS[targetType];
  if (!icon) return null;
  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={2}
      className={cn("size-3.5 shrink-0 text-muted-foreground/60", className)}
      aria-label={targetType}
    />
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "warn" | "danger";
}) {
  return (
    <Card className="rounded-md">
      <CardContent>
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {label}
        </div>
        <div
          className={cn(
            "mt-0.5 text-2xl font-semibold leading-tight",
            tone === "warn" && "text-amber-500",
            tone === "danger" && "text-destructive",
          )}
        >
          {formatNumber(value)}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

export function ActorChip({ event }: { event: AuditEvent }) {
  const name = event.actorLabel ?? event.actorEmail ?? event.actorId;
  const initials = (name || "?").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
        {initials}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12.5px]">{name}</span>
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
          {event.actorType}
        </span>
      </div>
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const variant =
    outcome === "success"
      ? "default"
      : outcome === "denied"
        ? "secondary"
        : "destructive";
  return <Badge variant={variant}>{outcome}</Badge>;
}

export function AuditPending() {
  return (
    <Card className="overflow-hidden rounded-md p-0 gap-0">
      <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-28 flex-1" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </div>
      ))}
    </Card>
  );
}
