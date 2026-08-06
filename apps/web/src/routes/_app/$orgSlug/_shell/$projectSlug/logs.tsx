/**
 * Project log explorer — a live, virtualized tail across the project's service
 * containers. Filters (service / level / search / time window) live in the URL
 * so a view is shareable and survives reload; the stream wiring, table and
 * virtualizer live in sibling feature files (`use-logs-table`, `logs-table-view`).
 *
 * Runtime | Edge source toggle (od-u63.5): the project's Edge logs tab merged
 * in here as a second source rather than a separate tab — both are "logs for
 * this project," just from different origins (container stdout vs the Caddy
 * access log). Edge content is unchanged from the old `edge-logs` route; only
 * the chrome that wraps it moved. See `$projectSlug/edge-logs.tsx` for the
 * redirect shim that keeps old links working.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { EdgeLogsView } from "@/features/edge-logs/components/edge-logs-view";
import {
  type LogsSearch,
  type LogsSource,
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
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { useDebouncedCallback } from "@/shared/components/data-grid/hooks/use-debounced-callback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { copyToClipboard } from "@/shared/lib/clipboard";

function copyLines(ls: LogLine[]) {
  const text = ls
    .map((l) => `${l.tsIso ?? l.ts} ${l.level.toUpperCase()} ${l.svc}  ${l.msg}`)
    .join("\n");
  void copyToClipboard(text);
}

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/logs")({
  staticData: { crumb: "Logs" },
  validateSearch: zLogsSearch,
  component: RouteComponent,
  // No loader preload: `resourceCollection` (drives the log source filter) is
  // syncMode "on-demand" — preload() is a no-op there; it loads when the live
  // query subscribes with its projectId filter.
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const activeEnv = useActiveEnvironment(project.id);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Replace (not push) so filtering doesn't spam the back-stack; the URL still
  // reflects the current view for sharing / reload.
  const patchSearch = (patch: Partial<LogsSearch>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  // Per-project resources, same source the graph reads from. Only services
  // populate the filter — database log streams land in a separate surface
  // (or on the resource detail panel's Logs tab) so they don't double up.
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), eq(r.environmentId, activeEnv.id ?? "")),
        ),
    [project.id, activeEnv.id],
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
  // Memoized: an inline `new Set(...)` was a fresh identity every render,
  // which invalidated the filter memos downstream on every tail frame and
  // forced a full re-filter (and react-table row-model rebuild) of the
  // whole buffer.
  const searchLevels = search.levels;
  const lvlFilter: Set<LogLevel> = useMemo(
    () => new Set(searchLevels ?? LOG_LEVELS),
    [searchLevels],
  );
  const timeFrom = search.from;
  const timeTo = search.to;
  const timeRange: TimeRange | null = useMemo(
    () => (timeFrom != null && timeTo != null ? { from: timeFrom, to: timeTo } : null),
    [timeFrom, timeTo],
  );

  // Search text stays local for input responsiveness and is debounced into the
  // URL so we don't navigate on every keystroke. Debounced from the change
  // handler rather than an effect on `query`: typing is the thing being
  // rate-limited, so arriving on the page shouldn't commit the value it just
  // read out of the URL back into it.
  const [query, setQuery] = useState(search.q ?? "");
  const commitQuery = useDebouncedCallback((q: string) => {
    patchSearch({ q: q.trim() || undefined });
  }, 300);
  const onQueryChange = (next: string) => {
    setQuery(next);
    commitQuery(next);
  };

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

  // Guard before scanning: with nothing selected (the common case, every tail
  // frame) this must cost nothing.
  const selectedLine =
    selectedId == null ? null : (t.filtered.find((l) => l.id === selectedId) ?? null);

  const badge = statusBadge(t.status, paused);

  const source: LogsSource = search.source;
  const setSource = (v: LogsSource) =>
    void navigate({
      search: (prev) => ({ ...prev, source: v }),
      replace: true,
    });

  return (
    // Explicit viewport height so the page itself never scrolls — only the
    // table container does. The flex chain above us bottoms out at
    // SidebarProvider's `min-h-svh` (a floor, not a cap), so `flex-1` can't
    // bound us; we must subtract the fixed chrome ourselves: the site header
    // (--header-height) and the sticky ProjectTabs bar (h-10 = 2.5rem).
    <Tabs
      value={source}
      onValueChange={(v) => setSource(v as LogsSource)}
      className="flex h-[calc(100svh-var(--header-height)-2.5rem)] flex-col gap-0 overflow-hidden"
    >
      <div className="flex items-center border-b px-4 pt-2">
        <TabsList variant="line" className="h-auto bg-transparent p-0">
          <TabsTrigger value="runtime" className="px-3 py-2">
            Runtime
          </TabsTrigger>
          <TabsTrigger value="edge" className="px-3 py-2">
            Edge
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="runtime" className="flex min-h-0 flex-1 flex-col gap-0">
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
          onQueryChange={onQueryChange}
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
      </TabsContent>

      <TabsContent value="edge" className="min-h-0 flex-1 overflow-hidden">
        <EdgeLogsView projectId={project.id} />
      </TabsContent>
    </Tabs>
  );
}
