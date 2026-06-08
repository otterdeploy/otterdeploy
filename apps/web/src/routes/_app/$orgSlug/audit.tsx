/**
 * Audit log — queryable, append-only record of every audit-worthy action
 * (mutations + all denials) across the org. Real data via `orpc.audit.list`,
 * which reads the `audit_log` table the evlog Postgres drain populates.
 *
 * Ported from the demo's audit screen: stat tiles + filters + event table +
 * a right-side detail drawer + CSV export — all wired to live events.
 */
import {
  Alert01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Download01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Input } from "@/shared/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/shared/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/audit")({
  staticData: { crumb: "Audit" },
  component: AuditRoute,
});

type Outcome = "success" | "failure" | "denied";
interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  actorType: "user" | "system" | "api" | "agent";
  actorId: string;
  actorEmail: string | null;
  actorLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  target: Record<string, unknown> | null;
  outcome: Outcome;
  reason: string | null;
  durationMs: number | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  causationId: string | null;
}

const RANGES = [
  { id: "24h", label: "Last 24h", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All time", ms: 0 },
] as const;

function AuditRoute() {
  const [range, setRange] = useState<string>("7d");
  const [outcome, setOutcome] = useState<string>("any");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [openId, setOpenId] = useState<string | null>(null);

  const from = useMemo(() => {
    const r = RANGES.find((x) => x.id === range);
    if (!r || r.ms === 0) return undefined;
    return new Date(Date.now() - r.ms).toISOString();
  }, [range]);

  const query = useQuery({
    ...orpc.audit.list.queryOptions({
      input: {
        q: q.trim() || undefined,
        outcome: outcome === "any" ? undefined : (outcome as Outcome),
        from,
        limit,
        offset: 0,
      },
    }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const items = (query.data?.items ?? []) as AuditEvent[];
  const counts = query.data?.counts ?? { total: 0, failed: 0, denied: 0 };
  const total = query.data?.total ?? 0;
  const opening = items.find((e) => e.id === openId) ?? null;

  return (
    <div className="flex flex-1 flex-col gap-5 p-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Append-only record of every administrative action across this
            workspace — mutations and denials.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={items.length === 0}
          onClick={() => exportCsv(items)}
        >
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          Export CSV
        </Button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="h-8 w-36"
        >
          {RANGES.map((r) => (
            <NativeSelectOption key={r.id} value={r.id}>
              {r.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="h-8 w-40"
        >
          <NativeSelectOption value="any">All outcomes</NativeSelectOption>
          <NativeSelectOption value="success">Success</NativeSelectOption>
          <NativeSelectOption value="denied">Denied</NativeSelectOption>
          <NativeSelectOption value="failure">Failed</NativeSelectOption>
        </NativeSelect>
        <div className="relative ml-auto">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search action / actor / target"
            className="h-8 w-64 pl-8"
          />
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Events" value={String(counts.total)} sub="matching filters" />
        <StatTile
          label="Failed"
          value={String(counts.failed)}
          sub="errored actions"
          tone={counts.failed > 0 ? "warn" : undefined}
        />
        <StatTile
          label="Denied"
          value={String(counts.denied)}
          sub="authz-blocked"
          tone={counts.denied > 0 ? "danger" : undefined}
        />
      </div>

      {/* Table */}
      {query.isLoading ? (
        <AuditPending />
      ) : query.isError ? (
        <p className="text-sm text-destructive">
          {(query.error as Error | null)?.message ?? "Failed to load audit events."}
        </p>
      ) : items.length === 0 ? (
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Alert01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No audit events</EmptyTitle>
            <EmptyDescription>
              Nothing matches these filters yet. Mutations and denials will
              appear here as they happen.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="overflow-hidden rounded-md p-0 gap-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <TableRow
                  key={e.id}
                  className={cn(
                    "cursor-pointer",
                    e.outcome !== "success" && "bg-amber-500/5",
                  )}
                  onClick={() => setOpenId(e.id)}
                >
                  <TableCell className="pl-4 font-mono text-[11px] text-muted-foreground">
                    {timeAgo(e.timestamp)}
                  </TableCell>
                  <TableCell>
                    <ActorChip event={e} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.targetId ?? e.targetType ?? "—"}
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={e.outcome} />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {e.ip ?? "—"}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className="ml-auto size-3.5 text-muted-foreground/60"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {items.length < total && (
            <div className="flex items-center justify-center gap-3 border-t bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
              <span>
                {items.length} of {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={query.isFetching}
                onClick={() => setLimit((n) => n + 50)}
              >
                {query.isFetching ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </Card>
      )}

      <EventDrawer event={opening} onClose={() => setOpenId(null)} />
    </div>
  );
}

// --- pieces -----------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
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
          {value}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function ActorChip({ event }: { event: AuditEvent }) {
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

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const variant =
    outcome === "success"
      ? "default"
      : outcome === "denied"
        ? "secondary"
        : "destructive";
  return <Badge variant={variant}>{outcome}</Badge>;
}

function EventDrawer({
  event,
  onClose,
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="sm:max-w-lg">
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
                <KV k="Timestamp" v={new Date(event.timestamp).toLocaleString()} mono />
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
                  <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(event.changes, null, 2)}
                  </pre>
                </Section>
              )}

              <Section label="Full event">
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[10.5px] leading-relaxed">
                  {JSON.stringify(event, null, 2)}
                </pre>
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

function AuditPending() {
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

// --- helpers ----------------------------------------------------------------

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = (t - Date.now()) / 1000;
  const abs = Math.abs(diff);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === "second") {
      return rtf.format(Math.round(diff / secs), unit);
    }
  }
  return "just now";
}

function exportCsv(items: AuditEvent[]) {
  const cols: Array<keyof AuditEvent> = [
    "timestamp",
    "action",
    "actorType",
    "actorId",
    "actorEmail",
    "outcome",
    "targetType",
    "targetId",
    "ip",
    "durationMs",
    "reason",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    cols.join(","),
    ...items.map((e) => cols.map((c) => esc(e[c])).join(",")),
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
