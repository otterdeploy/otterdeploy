/**
 * LogViewer — the terminal-style scroller shared by the deployment Build Logs
 * and Deploy Logs tabs (and any future single-stream tail).
 *
 * Owns the one fiddly bit every log pane repeated: auto-scroll that pins to the
 * bottom while the user is there and releases the moment they scroll up. The
 * empty state is passed in so each pane keeps its own copy ("connecting…",
 * "no logs match this filter", etc.) without forking the scroller.
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Alert02Icon, CancelCircleIcon, Copy01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/utils";

import { LogToolbar, type NavLevel, plural } from "./log-toolbar";

export interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

export type LogSeverity = "error" | "warn" | "success" | "info" | "normal";

/**
 * Severity is derived from the line's *content*, not its stream — build tools
 * (git, docker/buildkit, vite, bun) write ordinary progress to stderr, so the
 * stream is a useless error signal. We look for the markers those tools
 * actually print: `error:`/`ERROR`/`✖` (+ stack frames so a whole trace reads
 * as one red block), `warning`/`(!)`/`[plugin …]`, `✓`/`built in` for success,
 * and a leading `info:`/`[info]`. Everything else is plain output.
 */
export function classifyLogSeverity(line: string): LogSeverity {
  const s = line.trim();
  if (!s) return "normal";
  if (
    /(^|[^a-z])(error|fatal|panic|failed|failure|exception|traceback)([^a-z]|$)/i.test(s) ||
    /\b[A-Z]\w*Error\b/.test(s) || // TypeError, ReferenceError, …
    /[✖✗]/.test(s) ||
    /^at\s+\S/.test(s) || // stack frame — keeps the trace one contiguous block
    /^\.\.\.\s*\d+\s*lines? matching/i.test(s) ||
    /^cause:/i.test(s) ||
    /exit code:\s*[1-9]/i.test(s) ||
    /\bdid not complete successfully\b/i.test(s)
  ) {
    return "error";
  }
  if (/[✓✔]/.test(s) || /\bbuilt in\b/i.test(s) || /\bready in\b/i.test(s) || /\bcompiled successfully\b/i.test(s)) {
    return "success";
  }
  if (/(^|[^a-z])(warn|warning|deprecated)([^a-z]|$)/i.test(s) || /^\(!\)/.test(s) || /\[plugin\b/i.test(s)) {
    return "warn";
  }
  if (/^\[?(info|notice)\]?[:\s-]/i.test(s)) return "info";
  return "normal";
}

const SEVERITY_TEXT: Record<LogSeverity, string> = {
  error: "text-destructive",
  warn: "text-warning",
  success: "text-success",
  info: "text-info",
  normal: "text-foreground/85",
};

// The rounded left rail is the severity indicator — a colored pill for
// error/warn/info/success, a faint hairline for ordinary output so every
// line still sits on a consistent rail (matches the table-row pattern).
const SEVERITY_BAR: Record<LogSeverity, string> = {
  error: "bg-destructive",
  warn: "bg-warning",
  success: "bg-success",
  info: "bg-info",
  normal: "bg-muted-foreground/20",
};

export function LogLineRow({
  line,
  highlighted = false,
}: {
  line: LogLine;
  highlighted?: boolean;
}) {
  const severity = classifyLogSeverity(line.line);
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
        <span className="break-all whitespace-pre-wrap">{line.line}</span>
      </div>
    </div>
  );
}

interface Classified {
  line: LogLine;
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
  const classified = useMemo(
    () => lines.map((line) => ({ line, severity: classifyLogSeverity(line.line) })),
    [lines],
  );

  const q = query.trim().toLowerCase();
  // Text search narrows the visible set; the level chips navigate *within*
  // whatever is currently shown.
  const visible = useMemo(
    () => classified.filter((c) => (q ? c.line.line.toLowerCase().includes(q) : true)),
    [classified, q],
  );
  const errorMatches = useMemo(() => visible.filter((c) => c.severity === "error"), [visible]);
  const warnMatches = useMemo(() => visible.filter((c) => c.severity === "warn"), [visible]);
  const errorCount = errorMatches.length;
  const warnCount = warnMatches.length;

  const navMatches = nav?.level === "error" ? errorMatches : nav?.level === "warn" ? warnMatches : [];
  const navIndex = navMatches.length ? Math.min(nav?.index ?? 0, navMatches.length - 1) : 0;
  const currentMatchId = navMatches.length ? (navMatches[navIndex]?.line.id ?? null) : null;

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
    const text = visible.map((c) => c.line.line).join("\n");
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${visible.length} ${plural(visible.length, "line")}`),
      () => toast.error("Couldn't copy logs"),
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
        className="min-h-0 flex-1 overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-3 font-mono text-[11.5px] leading-relaxed"
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


