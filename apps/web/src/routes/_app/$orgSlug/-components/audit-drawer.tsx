import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { type AuditEvent } from "@/features/audit/data/audit";
import { JsonView } from "@/shared/components/ui/json-view";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { timeAgo } from "./audit-helpers";
import { ActionDot, ActorChip, OutcomeBadge, TargetKindIcon } from "./audit-parts";

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
