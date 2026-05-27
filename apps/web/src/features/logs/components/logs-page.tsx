import { useEffect, useMemo, useRef, useState } from "react";

import {
  LOG_LEVELS,
  useProjectLogStream,
  type LogLevel,
} from "../data/use-project-log-stream";
import { LogRow } from "./log-row";
import { LogsHistogram } from "./logs-histogram";
import { LogsToolbar, type StatusBadge } from "./logs-toolbar";

interface LogsPageProps {
  projectId: string;
  services: { id: string; name: string }[];
  initialService?: string | null;
}

export function LogsPage({ projectId, services, initialService }: LogsPageProps) {
  // Filter by resource id, not name — names collide across forks and
  // renames, ids are stable for the life of the resource.
  const [svcFilter, setSvcFilter] = useState<string>(initialService ?? "all");
  const [lvlFilter, setLvlFilter] = useState<Set<LogLevel>>(
    () => new Set(LOG_LEVELS),
  );
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const subscribedIds = useMemo(
    () => (svcFilter === "all" ? undefined : [svcFilter]),
    [svcFilter],
  );
  const { lines, status } = useProjectLogStream({
    projectId,
    resourceIds: subscribedIds,
    paused,
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter(
      (l) =>
        lvlFilter.has(l.level) &&
        (!needle || l.msg.toLowerCase().includes(needle)),
    );
  }, [lines, lvlFilter, query]);

  const toggleLevel = (lv: LogLevel) =>
    setLvlFilter((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });

  const copyVisible = () => {
    const text = filtered
      .map((l) => `${l.tsIso ?? l.ts} ${l.level.toUpperCase()} ${l.svc}  ${l.msg}`)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  };

  const badge = statusBadge(status, paused);

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] flex-col overflow-hidden">
      <LogsHistogram
        lines={filtered}
        loadedCount={lines.length}
        matchCount={filtered.length}
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
        wrap={wrap}
        onToggleWrap={() => setWrap((w) => !w)}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        onCopy={copyVisible}
      />

      <div className="flex border-b bg-muted/20 px-4 py-1.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground/70">
        <span className="w-1" />
        <span className="w-6" />
        <span className="w-28">Timestamp</span>
        <span className="w-14">Level</span>
        <span className="w-20">Service</span>
        <span className="flex-1 px-3">Message</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          stickToBottom.current = atBottom;
        }}
        className="flex-1 overflow-auto font-mono"
      >
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-muted-foreground">
            {status === "connecting"
              ? "Connecting to log stream…"
              : "No logs match these filters."}
          </div>
        ) : (
          filtered.map((l) => (
            <LogRow
              key={l.id}
              line={l}
              expanded={!!expanded[l.id]}
              wrap={wrap}
              onToggle={() =>
                setExpanded((prev) => ({ ...prev, [l.id]: !prev[l.id] }))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function statusBadge(
  status: "connecting" | "live" | "ended" | "error",
  paused: boolean,
): StatusBadge {
  // Paused overrides any stream status — operator explicitly stopped the tail.
  if (paused) {
    return {
      label: "paused",
      dot: "bg-muted-foreground/50",
      tone: "bg-muted text-muted-foreground",
    };
  }
  switch (status) {
    case "live":
      return {
        label: "live tail",
        dot: "bg-success animate-pulse",
        tone: "bg-success/12 text-success",
      };
    case "connecting":
      return {
        label: "connecting",
        dot: "bg-warning animate-pulse",
        tone: "bg-warning/12 text-warning",
      };
    case "ended":
      return {
        label: "ended",
        dot: "bg-muted-foreground/50",
        tone: "bg-muted text-muted-foreground",
      };
    case "error":
      return {
        label: "error",
        dot: "bg-destructive",
        tone: "bg-destructive/12 text-destructive",
      };
  }
}
