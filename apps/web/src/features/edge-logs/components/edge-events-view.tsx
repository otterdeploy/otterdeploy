import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { HostFilter } from "./host-filter";

type EdgeEvent = Awaited<
  ReturnType<typeof orpc.edgeLogs.events.query.call>
>["rows"][number];

const RANGES = ["5m", "1h", "6h", "24h", "7d"] as const;
const CATEGORIES = ["cert", "upstream", "config", "other"] as const;
const LEVELS = ["error", "warn", "info"] as const;
type Range = (typeof RANGES)[number];
type Category = (typeof CATEGORIES)[number];
type Level = (typeof LEVELS)[number];

const LEVEL_TEXT: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-sky-500",
  debug: "text-muted-foreground",
};
const CATEGORY_TEXT: Record<string, string> = {
  cert: "text-sky-500",
  upstream: "text-amber-500",
  config: "text-muted-foreground",
  other: "text-muted-foreground",
};

/**
 * Edge events view — the operational log plane (Phase 3). Caddy's default
 * logger: TLS/ACME certificate lifecycle and reverse_proxy upstream errors,
 * scoped to the caller's domains. Mirrors the access-log view's full-bleed
 * table; no histogram/percentiles (these are discrete events, not requests).
 */
export function EdgeEventsView({ projectId }: { projectId?: string }) {
  const [range, setRange] = useState<Range>("1h");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [hostFilter, setHostFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({
    ...orpc.edgeLogs.events.query.queryOptions({
      input: {
        projectId,
        range,
        categories: categories.size
          ? ([...categories] as Category[])
          : undefined,
        levels: levels.size ? ([...levels] as Level[]) : undefined,
        hosts: hostFilter.length ? hostFilter : undefined,
        search: search.trim() || undefined,
      },
    }),
    refetchInterval: live ? 2000 : false,
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  // No hostStats here — derive the filter options from the rows themselves
  // (each event's host plus any batch domains).
  const hostOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.rows ?? []) {
      if (r.host) set.add(r.host);
      for (const d of r.domains) set.add(d);
    }
    return [...set].sort();
  }, [data?.rows]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">Edge events</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px]",
              live ? "text-success" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                live ? "animate-pulse bg-success" : "bg-muted-foreground",
              )}
            />
            {live ? "live tail" : "paused"}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Caddy's operational log — TLS/ACME certificate lifecycle and upstream
          errors. Live-tailed from the proxy's default logger.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Segmented options={RANGES} value={range} onChange={(v) => setRange(v as Range)} />
        <Chips
          options={CATEGORIES}
          selected={categories}
          colors={CATEGORY_TEXT}
          onToggle={(v) => setCategories((s) => toggleSet(s, v))}
        />
        <Chips
          options={LEVELS}
          selected={levels}
          colors={LEVEL_TEXT}
          onToggle={(v) => setLevels((s) => toggleSet(s, v))}
        />
        <HostFilter options={hostOptions} value={hostFilter} onChange={setHostFilter} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search message, host, error…"
          className="h-8 max-w-xs text-[12px]"
        />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className={cn(wrap && "bg-muted")}
          onClick={() => setWrap((v) => !v)}
          title="Wrap long values in expanded rows instead of truncating"
        >
          Wrap
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLive((v) => !v)}>
          {live ? "Pause" : "Resume"}
        </Button>
      </div>

      {/* Event table — full bleed, separators only */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table className="[&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
          <TableHeader>
            <TableRow className="border-b bg-muted/30 hover:bg-transparent">
              <TableHead className="w-8" />
              {["Time", "Level", "Category", "Host", "Message"].map((h) => (
                <TableHead
                  key={h}
                  className="h-8 text-[10px] font-semibold uppercase tracking-[0.06em]"
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-[13px] text-muted-foreground"
                >
                  {query.isLoading
                    ? "Loading…"
                    : "No edge events in this window. Certificate activity and upstream errors for your domains appear here."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <EventRow
                  key={r.id}
                  row={r}
                  wrap={wrap}
                  open={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function toggleSet(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function Chips({
  options,
  selected,
  onToggle,
  colors,
}: {
  options: readonly string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  colors: Record<string, string>;
}) {
  const none = selected.size === 0;
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const active = selected.has(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-all",
              colors[o],
              active && "bg-muted",
              !active && !none && "opacity-40 hover:opacity-100",
              !active && none && "opacity-80 hover:opacity-100",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function EventRow({
  row,
  wrap,
  open,
  onToggle,
}: {
  row: EdgeEvent;
  wrap: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer font-mono text-[12px]" onClick={onToggle}>
        <TableCell className="text-muted-foreground">
          <span className={cn("inline-block transition-transform", open && "rotate-90")}>›</span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {new Date(row.ts).toLocaleTimeString()}
        </TableCell>
        <TableCell>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              LEVEL_TEXT[row.level],
            )}
          >
            {row.level}
          </span>
        </TableCell>
        <TableCell className={cn("font-semibold", CATEGORY_TEXT[row.category])}>
          {row.category}
        </TableCell>
        <TableCell className="text-foreground/80">
          {row.host ?? (row.domains.length ? `${row.domains.length} domains` : "—")}
        </TableCell>
        <TableCell
          className={cn(
            "text-foreground/80",
            wrap ? "max-w-[520px] break-all" : "max-w-[360px] truncate",
          )}
        >
          {row.msg}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={6} className="py-3">
            <div className="w-0 min-w-full overflow-hidden">
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 font-mono text-[12px]">
                <Detail k="logger" v={row.logger} wrap={wrap} />
                {row.upstream ? <Detail k="upstream" v={row.upstream} wrap={wrap} /> : null}
                {row.error ? <Detail k="error" v={row.error} wrap={wrap} wide /> : null}
                {row.domains.length ? (
                  <Detail k="domains" v={row.domains.join(", ")} wrap={wrap} wide />
                ) : null}
              </div>
              <div className="mt-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Raw
                </div>
                <pre
                  className={cn(
                    "max-h-64 overflow-auto rounded-md border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed",
                    wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                  )}
                >
                  {row.raw}
                </pre>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function Detail({
  k,
  v,
  wide,
  wrap,
}: {
  k: string;
  v: string;
  wide?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 gap-2", wide && "col-span-2")}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("min-w-0 text-foreground/90", wrap ? "break-all" : "truncate")}>
        {v}
      </span>
    </div>
  );
}
