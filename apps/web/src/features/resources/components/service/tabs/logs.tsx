/**
 * Logs tab for a deployed service — a live runtime tail scoped to just this
 * resource. Reuses the project log stream (`useProjectLogStream`) with a
 * one-id whitelist, so transport, ring-buffering, level inference, and
 * multi-line coalescing all match the project-wide Logs page; this file only
 * owns the slim toolbar (level chips / search / pause / wrap / copy) and a
 * follow-the-tail scroller.
 */

import { useEffect, useRef, useState } from "react";

import {
  ContainerIcon,
  Copy01Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
  TextWrapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { statusBadge } from "@/features/logs/components/logs-status";
import {
  LEVEL_STRIPE,
  LEVEL_TEXT,
  LOG_LEVELS,
  useProjectLogStream,
  type LogLevel,
  type LogLine,
} from "@/features/logs/data/use-project-log-stream";
import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

function LogRow({ line, wrap }: { line: LogLine; wrap: boolean }) {
  return (
    <div className="flex items-stretch gap-2.5">
      <span className={cn("w-[3px] shrink-0 rounded-full", LEVEL_STRIPE[line.level])} />
      <span className="shrink-0 text-muted-foreground/50">{line.ts}</span>
      <span
        className={cn(
          LEVEL_TEXT[line.level],
          wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
        )}
      >
        {line.msg}
      </span>
    </div>
  );
}

/** The toolbar's right-side controls — wrap toggle, pause/resume, copy. */
function TailControls({
  wrap,
  onToggleWrap,
  paused,
  onTogglePause,
  onCopy,
}: {
  wrap: boolean;
  onToggleWrap: () => void;
  paused: boolean;
  onTogglePause: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 gap-1.5 text-[12px]", !wrap && "text-muted-foreground/60")}
        onClick={onToggleWrap}
      >
        <HugeiconsIcon icon={TextWrapIcon} strokeWidth={2} className="size-3.5" />
        Wrap
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-[12px]"
        onClick={onTogglePause}
      >
        <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} strokeWidth={2} className="size-3.5" />
        {paused ? "Resume" : "Pause"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy visible lines"
        onClick={onCopy}
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
    </div>
  );
}

export function ServiceLogsTab({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState("");
  const [lvlFilter, setLvlFilter] = useState<Set<LogLevel>>(() => new Set(LOG_LEVELS));

  const resourceIds = [resourceId];
  const { lines, status } = useProjectLogStream({ projectId, resourceIds, paused });

  const needle = query.trim().toLowerCase();
  const visible = lines.filter(
    (l) => lvlFilter.has(l.level) && (!needle || l.msg.toLowerCase().includes(needle)),
  );

  // Real container output vs. the stream's own control lines ("Tailing N
  // services", "no container yet"). With no real output we show a proper empty
  // state instead of rendering those system lines as if they were app logs.
  const hasOutput = lines.some((l) => l.stream !== "system");

  // Follow the tail while the operator sits at the bottom; release on scroll-up.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (!follow) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, follow, wrap]);

  const toggleLevel = (lv: LogLevel) =>
    setLvlFilter((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });

  const copyVisible = () => {
    const text = visible.map((l) => `${l.ts} ${l.msg}`).join("\n");
    if (!text) return;
    void copyToClipboard(text).then((ok) =>
      ok
        ? toast.success(`Copied ${visible.length} line${visible.length === 1 ? "" : "s"}`)
        : toast.error("Couldn't copy logs"),
    );
  };

  const badge = statusBadge(status, paused);

  return (
    <div className="flex h-full min-h-80 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
          {LOG_LEVELS.map((lv) => {
            const on = lvlFilter.has(lv);
            return (
              <button
                key={lv}
                type="button"
                onClick={() => toggleLevel(lv)}
                aria-pressed={on}
                className={cn(
                  "rounded px-2 py-0.5 font-mono text-[11px] transition-colors",
                  on
                    ? cn("bg-background font-medium shadow-sm", LEVEL_TEXT[lv])
                    : "text-muted-foreground/60 hover:text-foreground/80",
                )}
              >
                {lv}
              </button>
            );
          })}
        </div>

        <div className="relative max-w-72 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter log messages"
            placeholder="filter messages…"
            className="h-7 w-full rounded-md border bg-transparent pl-8 font-mono text-[11.5px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-foreground/20"
          />
        </div>

        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-widest uppercase",
            badge.tone,
          )}
        >
          <span className={cn("size-1.5 rounded-full", badge.dot)} />
          {badge.label}
        </span>

        <TailControls
          wrap={wrap}
          onToggleWrap={() => setWrap((w) => !w)}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onCopy={copyVisible}
        />
      </div>

      <div
        ref={scrollerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          if (atBottom !== follow) setFollow(atBottom);
        }}
        className="min-h-0 flex-1 overflow-auto rounded-md border bg-terminal text-terminal-foreground p-3 font-mono text-[11.5px] leading-relaxed"
      >
        {!hasOutput ? (
          <div className="grid h-full min-h-40 place-items-center text-center">
            <div className="flex max-w-sm flex-col items-center gap-2.5">
              <div className="grid size-11 place-items-center rounded-full border border-border/50 bg-foreground/[0.03] text-muted-foreground/70">
                <HugeiconsIcon icon={ContainerIcon} strokeWidth={1.8} className="size-5" />
              </div>
              <div className="text-[13px] font-medium text-foreground/80">
                {status === "connecting"
                  ? "Connecting to the log stream…"
                  : status === "error"
                    ? "Log stream disconnected"
                    : "No container running yet"}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {status === "connecting"
                  ? "Attaching to this service's live output."
                  : status === "error"
                    ? "Retrying automatically."
                    : "Deploy this service and its container logs will stream here live."}
              </div>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="grid h-full min-h-40 place-items-center text-center text-[12px] text-muted-foreground">
            No lines match the current filters.
          </div>
        ) : (
          visible.map((l) => <LogRow key={l.id} line={l} wrap={wrap} />)
        )}
      </div>
    </div>
  );
}
