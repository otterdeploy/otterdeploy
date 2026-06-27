import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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
import { formatNumber } from "@otterdeploy/shared/format";

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
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        {event && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2 font-mono text-sm">
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
                <KV k="Type" v={event.targetType ?? "—"} />
                <KV k="ID" v={event.targetId ?? "—"} mono />
              </Section>

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
