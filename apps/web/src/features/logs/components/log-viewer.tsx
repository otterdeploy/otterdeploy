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

import { toast } from "sonner";

import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

import { AnsiLine, stripAnsi } from "./ansi";
import { classifyLogSeverity, markEventHeads, SEVERITY_BAR, SEVERITY_TEXT } from "./log-severity";
import { LogToolbar, type NavLevel, plural } from "./log-toolbar";

export interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

export function LogLineRow({
  line,
  highlighted = false,
}: {
  line: LogLine;
  highlighted?: boolean;
}) {
  // Classify + search on ANSI-stripped text; render with the tool's own
  // colors via AnsiLine (a raw ESC byte is invisible in HTML, so untreated
  // lines would show literal `[32m✓[39m` garbage).
  const severity = classifyLogSeverity(stripAnsi(line.line));
  return (
    <div
      data-log-id={line.id}
      className={cn(
        "flex scroll-my-8 items-stretch gap-2.5 rounded-sm",
        highlighted && "bg-foreground/10 ring-1 ring-foreground/15 ring-inset",
      )}
    >
      <span className={cn("w-[3px] shrink-0 rounded-full", SEVERITY_BAR[severity])} />
      <div className={cn("flex min-h-[1.35em] flex-1 gap-3", SEVERITY_TEXT[severity])}>
        {line.ts && (
          <span className="shrink-0 text-muted-foreground/50">
            {line.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
          </span>
        )}
        <span className="break-all whitespace-pre-wrap">
          <AnsiLine text={line.line} />
        </span>
      </div>
    </div>
  );
}

interface Classified {
  line: LogLine;
  /** ANSI-stripped text — what search, severity and copy operate on. */
  text: string;
  severity: ReturnType<typeof classifyLogSeverity>;
}

// Resolve the active navigator into the match list, a clamped index (matches
// shrink as logs stream / search narrows), and the id of the current match.
function resolveNav(
  nav: { level: NavLevel; index: number } | null,
  errorMatches: Classified[],
  warnMatches: Classified[],
) {
  const matches = nav?.level === "error" ? errorMatches : nav?.level === "warn" ? warnMatches : [];
  const index = matches.length ? Math.min(nav?.index ?? 0, matches.length - 1) : 0;
  const currentId = matches.length ? (matches[index]?.line.id ?? null) : null;
  return { index, currentId };
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [query, setQuery] = useState("");
  // Which severity we're stepping through, and how far in. Navigation keeps
  // every line visible (unlike a filter) and just jumps between matches.
  const [nav, setNav] = useState<{ level: NavLevel; index: number } | null>(null);

  // ⌘F / Ctrl+F focuses the find box — but only while the pointer/focus is on
  // this log pane, so it never fights the browser's page find elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
      const root = rootRef.current;
      if (root && (root.contains(document.activeElement) || root.matches(":hover"))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Classify once, then reuse for the counts, the match lists, and the rows.
  const classified = lines.map((line) => {
    const text = stripAnsi(line.line);
    return { line, text, severity: classifyLogSeverity(text) };
  });

  const q = query.trim().toLowerCase();
  // Text search narrows the visible set; the level chips navigate *within*
  // whatever is currently shown.
  const visible = classified.filter((c) => (q ? c.text.toLowerCase().includes(q) : true));
  // A thrown error spans a header + its stack frames + a `{ … }` object dump;
  // count and step through those *events*, not every line the trace paints red.
  const eventHeads = markEventHeads(visible);
  const errorMatches = visible.filter((c, i) => eventHeads[i] && c.severity === "error");
  const warnMatches = visible.filter((c, i) => eventHeads[i] && c.severity === "warn");
  const errorCount = errorMatches.length;
  const warnCount = warnMatches.length;

  const { index: navIndex, currentId: currentMatchId } = resolveNav(nav, errorMatches, warnMatches);

  // Auto-scroll to bottom as new lines arrive — unless the user scrolled up,
  // or is currently stepping through matches (that owns the scroll position).
  useEffect(() => {
    if (!autoScroll || nav) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, autoScroll, nav]);

  // Bring the active match into view whenever it changes.
  useEffect(() => {
    if (currentMatchId == null) return;
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-log-id="${currentMatchId}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [currentMatchId]);

  const activateNav = (level: NavLevel) => {
    setAutoScroll(false);
    setNav((prev) => (prev?.level === level ? null : { level, index: 0 }));
  };
  const stepNav = (dir: 1 | -1) => {
    setNav((prev) => {
      if (!prev) return prev;
      const matches = prev.level === "error" ? errorMatches : warnMatches;
      if (matches.length === 0) return prev;
      return { level: prev.level, index: (prev.index + dir + matches.length) % matches.length };
    });
  };

  const copyVisible = () => {
    const text = visible.map((c) => c.text).join("\n");
    if (!text) return;
    void copyToClipboard(text).then((ok) =>
      ok
        ? toast.success(`Copied ${visible.length} ${plural(visible.length, "line")}`)
        : toast.error("Couldn't copy logs"),
    );
  };

  const countLabel = q
    ? `${visible.length} ${plural(visible.length, "match", "matches")}`
    : `${lines.length} ${plural(lines.length, "line")}`;

  const hasLines = lines.length > 0;

  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      {hasLines && (
        <LogToolbar
          countLabel={countLabel}
          errorCount={errorCount}
          warnCount={warnCount}
          activeLevel={nav?.level ?? null}
          navIndex={navIndex}
          onActivate={activateNav}
          onStep={stepNav}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          onCopy={copyVisible}
        />
      )}
      <div
        ref={scrollerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          if (atBottom !== autoScroll) setAutoScroll(atBottom);
        }}
        className="min-h-0 flex-1 overflow-auto rounded-md border bg-terminal text-terminal-foreground p-3 font-mono text-[11.5px] leading-relaxed"
      >
        {!hasLines ? (
          empty
        ) : visible.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-[12px] text-muted-foreground">
            No lines match your search.
          </div>
        ) : (
          visible.map((c) => <LogLineRow key={c.line.id} line={c.line} />)
        )}
      </div>
    </div>
  );
}
