import { useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import {
  CATEGORIES,
  CATEGORY_TEXT,
  type Category,
  EventsTable,
  LEVEL_TEXT,
  LEVELS,
  type Level,
} from "./edge-events-view-parts";
import { Chips, LiveBadge, RANGES, type Range, Segmented, toggleSet } from "./edge-logs-shared";
import { HostFilter } from "./host-filter";

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
        categories: categories.size ? ([...categories] as Category[]) : undefined,
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
          <LiveBadge live={live} />
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Caddy's operational log — TLS/ACME certificate lifecycle and upstream errors. Live-tailed
          from the proxy's default logger.
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

      <EventsTable
        rows={rows}
        wrap={wrap}
        expanded={expanded}
        setExpanded={setExpanded}
        isLoading={query.isLoading}
      />
    </div>
  );
}
