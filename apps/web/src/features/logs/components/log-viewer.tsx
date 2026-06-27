/**
 * LogViewer — the terminal-style scroller shared by the deployment Build Logs
 * and Deploy Logs tabs (and any future single-stream tail).
 *
 * Owns the one fiddly bit every log pane repeated: auto-scroll that pins to the
 * bottom while the user is there and releases the moment they scroll up. The
 * empty state is passed in so each pane keeps its own copy ("connecting…",
 * "no logs match this filter", etc.) without forking the scroller.
 */

import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";

export interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

export function LogLineRow({ line }: { line: LogLine }) {
  return (
    <div
      className={cn("flex gap-3", {
        "text-destructive/90": line.stream === "stderr",
        "text-muted-foreground italic": line.stream === "system",
        "text-foreground/85": line.stream === "stdout",
      })}
    >
      {line.ts && (
        <span className="shrink-0 text-muted-foreground/50">
          {line.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
        </span>
      )}
      <span className="break-all whitespace-pre-wrap">{line.line}</span>
    </div>
  );
}

export function LogViewer({
  lines,
  empty,
  className,
}: {
  lines: LogLine[];
  /** Rendered in place of the rows when there are none. */
  empty: ReactNode;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom on new lines; pauses if the user scrolls away.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div
      ref={scrollerRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
        if (atBottom !== autoScroll) setAutoScroll(atBottom);
      }}
      className={cn(
        "min-h-0 flex-1 overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-3 font-mono text-[11.5px] leading-relaxed",
        className,
      )}
    >
      {lines.length === 0 ? empty : lines.map((l) => <LogLineRow key={l.id} line={l} />)}
    </div>
  );
}
