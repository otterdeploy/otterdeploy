/**
 * Project log explorer — a live, virtualized tail across the project's service
 * containers. Filters (service / level / search / time window) live in the URL
 * so a view is shareable and survives reload; the stream wiring, table and
 * virtualizer live in sibling feature files (`use-logs-table`, `logs-table-view`).
 */

import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import {
  type LogsSearch,
  zLogsSearch,
} from "@/features/logs/data/logs-search";
import {
  LOG_LEVELS,
  type LogLevel,
  type LogLine,
} from "@/features/logs/data/use-project-log-stream";
import { LogDetailsPanel } from "@/features/logs/components/log-details-panel";
import { LogsHistogram, type TimeRange } from "@/features/logs/components/logs-histogram";
import { LogsTableView } from "@/features/logs/components/logs-table-view";
import { LogsToolbar } from "@/features/logs/components/logs-toolbar";
import { statusBadge } from "@/features/logs/components/logs-status";
import { useLogsTable } from "@/features/logs/components/use-logs-table";
import { resourceCollection } from "@/features/resources/data/resource";
import { copyToClipboard } from "@/shared/lib/clipboard";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/logs")({
  staticData: { crumb: "Logs" },
  validateSearch: zLogsSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Replace (not push) so filtering doesn't spam the back-stack; the URL still
  // reflects the current view for sharing / reload.
  const patchSearch = useCallback(
    (patch: Partial<LogsSearch>) => {
      void navigate({
        search: (prev) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  // Per-project resources, same source the graph reads from. Only services
  // populate the filter — database log streams land in a separate surface
  // (or on the resource detail panel's Logs tab) so they don't double up.
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );
  const services = useMemo(
    () =>
      resources.flatMap((r) =>
        r.type === "service" ? [{ id: r.resourceId, name: r.name }] : [],
      ),
    [resources],
  );

  // Filters live in the URL (shareable / reproducible). Service is keyed by
  // resource id — names collide across forks/renames, ids are stable.
  const svcFilter = search.service ?? "all";
  const lvlFilter = useMemo<Set<LogLevel>>(
    () => new Set(search.levels ?? LOG_LEVELS),
    [search.levels],
  );
  // Memoized on the primitive bounds: a fresh `{ from, to }` each render would
  // give `filtered` a new identity, which feeds the table + virtualizer and
  // spins them into an infinite re-render loop.
  const timeRange = useMemo<TimeRange | null>(
    () =>
      search.from != null && search.to != null
        ? { from: search.from, to: search.to }
        : null,
    [search.from, search.to],
  );

  // Search text stays local for input responsiveness and is debounced into the
  // URL below so we don't navigate on every keystroke.
  const [query, setQuery] = useState(search.q ?? "");
  // `patchSearch` follows router `navigate` identity; keep it out of the
  // effect's deps so the debounce timer resets only on `query` changes.
  const commitQuery = useEffectEvent((q: string) => {
    patchSearch({ q: q.trim() || undefined });
  });
  useEffect(() => {
    const id = setTimeout(() => commitQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setSvcFilter = (v: string) =>
    patchSearch({ service: v === "all" ? undefined : v });
  const toggleLevel = (lv: LogLevel) => {
    const next = new Set(lvlFilter);
    if (next.has(lv)) next.delete(lv);
    else next.add(lv);
    const arr = LOG_LEVELS.filter((l) => next.has(l));
    patchSearch({ levels: arr.length === LOG_LEVELS.length ? undefined : arr });
  };
  const setTimeRange = (r: TimeRange | null) =>
    patchSearch({ from: r?.from, to: r?.to });

  const t = useLogsTable({
    projectId: project.id,
    svcFilter,
    lvlFilter,
    query,
    timeRange,
    paused,
  });

  const selectedLine = useMemo(
    () => t.filtered.find((l) => l.id === selectedId) ?? null,
    [t.filtered, selectedId],
  );

  const copyLines = (ls: LogLine[]) => {
    const text = ls
      .map((l) => `${l.tsIso ?? l.ts} ${l.level.toUpperCase()} ${l.svc}  ${l.msg}`)
      .join("\n");
    void copyToClipboard(text);
  };

  const badge = statusBadge(t.status, paused);

  return (
    // Explicit viewport height so the page itself never scrolls — only the
    // table container does. The flex chain above us bottoms out at
    // SidebarProvider's `min-h-svh` (a floor, not a cap), so `flex-1` can't
    // bound us; we must subtract the fixed chrome ourselves: the site header
    // (--header-height) and the sticky ProjectTabs bar (h-10 = 2.5rem).
    <div className="flex h-[calc(100svh-var(--header-height)-2.5rem)] flex-col overflow-hidden">
      <LogsHistogram
        lines={t.filteredByMeta}
        loadedCount={t.lines.length}
        matchCount={t.filtered.length}
        selectedRange={timeRange}
        onSelectRange={setTimeRange}
      />

      <LogsToolbar
        services={services}
        svcFilter={svcFilter}
        onSvcChange={setSvcFilter}
        lvlFilter={lvlFilter}
        onToggleLevel={toggleLevel}
        query={query}
        onQueryChange={setQuery}
        badge={badge}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        onCopy={() => copyLines(t.filtered)}
        selectedCount={t.selectedCount}
        onCopySelected={() =>
          copyLines(t.table.getSelectedRowModel().rows.map((r) => r.original))
        }
        onClearSelection={() => t.table.resetRowSelection()}
      />

      <div className="relative flex min-h-0 flex-1">
        <LogsTableView
          table={t.table}
          rows={t.rows}
          virtualizer={t.virtualizer}
          scrollRef={t.scrollRef}
          status={t.status}
          selectedId={selectedId}
          onSelect={setSelectedId}
          isDefaultSort={t.isDefaultSort}
          hasTimeRange={timeRange != null}
          matchCount={t.filtered.length}
          follow={t.follow}
          onFollowChange={t.setFollow}
        />
        <LogDetailsPanel line={selectedLine} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}
