import {
  Alert01Icon,
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
import { useQuery } from "@tanstack/react-query";

import { type AuditEvent, type Outcome } from "@/features/audit/data/audit";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { JsonView } from "@/shared/components/ui/json-view";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";
import { formatNumber } from "@otterdeploy/shared/format";

import { type ActionTone, actionTone, timeAgo } from "./audit-helpers";

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

export function EventDrawer({
  event,
  onClose,
  onSelect,
}: {
  event: AuditEvent | null;
  onClose: () => void;
  /** Swap the drawer to another event (correlated mini-row click). */
  onSelect: (event: AuditEvent) => void;
}) {
  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        {event && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                <ActionDot action={event.action} className="size-2" />
                {event.action}
                <OutcomeBadge outcome={event.outcome} />
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-5 overflow-auto px-4 pb-4">
              {event.reason && event.outcome !== "success" && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[12px] text-amber-600 dark:text-amber-400">
                  <HugeiconsIcon
                    icon={Alert01Icon}
                    strokeWidth={2}
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span>{event.reason}</span>
                </div>
              )}

              <Section label="Actor">
                <ActorChip event={event} />
                <KV k="ID" v={event.actorId} mono />
                {event.actorEmail && <KV k="Email" v={event.actorEmail} />}
              </Section>

              <Section label="Target">
                <div className="flex items-center gap-1.5 py-1 text-[12px]">
                  <TargetKindIcon targetType={event.targetType} />
                  <span>{event.targetType ?? "—"}</span>
                </div>
                <KV k="ID" v={event.targetId ?? "—"} mono />
              </Section>

              {/* The demo also showed a geo lookup, a session id, and an HTTP
                  response code here — none of those are stored on audit_log
                  (only outcome/reason/durationMs + ip/ua), so we don't render
                  them rather than invent data. */}
              <Section label="When · where">
                <KV
                  k="Timestamp"
                  v={new Date(event.timestamp).toLocaleString()}
                  mono
                />
                <KV k="IP" v={event.ip ?? "—"} mono />
                <KV
                  k="Duration"
                  v={event.durationMs != null ? `${event.durationMs} ms` : "—"}
                  mono
                />
                <KV k="User-Agent" v={event.userAgent ?? "—"} mono />
              </Section>

              {(event.correlationId || event.causationId) && (
                <Section label="Correlation">
                  {event.correlationId && (
                    <KV k="Correlation" v={event.correlationId} mono />
                  )}
                  {event.causationId && (
                    <KV k="Caused by" v={event.causationId} mono />
                  )}
                  <CorrelatedEvents event={event} onSelect={onSelect} />
                </Section>
              )}

              {event.changes && (
                <Section label="Changes">
                  <JsonView
                    data={event.changes}
                    className="max-h-72 rounded-lg border bg-muted/30 p-3.5 text-[13px]"
                  />
                </Section>
              )}

              <Section label="Full event">
                <JsonView
                  data={event}
                  className="max-h-96 rounded-lg border bg-muted/30 p-3.5 text-[13px]"
                />
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Sibling events of the open one — everything sharing its correlationId plus
 * the causing event — rendered as clickable mini-rows that swap the drawer.
 * Server-resolved (`audit.byCorrelation`): siblings usually fall outside the
 * loaded page, so the client-side rows can't answer this.
 */
function CorrelatedEvents({
  event,
  onSelect,
}: {
  event: AuditEvent;
  onSelect: (event: AuditEvent) => void;
}) {
  const related = useQuery({
    ...orpc.audit.byCorrelation.queryOptions({
      input: {
        correlationId: event.correlationId ?? undefined,
        causationId: event.causationId ?? undefined,
      },
    }),
    staleTime: 30_000,
  });
  const siblings = (related.data?.items ?? []).filter((s) => s.id !== event.id);
  if (siblings.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Correlated events
      </div>
      <div className="flex flex-col gap-1">
        {siblings.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className="flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-muted/50"
          >
            <ActionDot action={s.action} />
            <span className="font-mono">{s.action}</span>
            {s.id === event.causationId && (
              <span className="rounded-sm bg-muted px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                cause
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {s.targetId ?? s.targetType ?? ""}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {timeAgo(s.timestamp)}
            </span>
            <OutcomeBadge outcome={s.outcome} />
          </button>
        ))}
      </div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-1 text-[12px]">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("min-w-0 flex-1 break-all", mono && "font-mono")}>
        {v}
      </span>
    </div>
  );
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
