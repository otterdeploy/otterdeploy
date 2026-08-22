// Live tail of every service log in a project. Ringbuffered client-side so
// the page stays responsive even on chatty stacks; filtering / search runs
// against this buffer, so anything dropped here is gone from the UI too.
//
// `paused` keeps the existing buffer but suspends new pushes. Flips back to
// live without dropping rows, so the operator can scroll back to read.
//
// Transport + buffering are the shared `useLogStream`; this hook only adds the
// project-fan-in line shape (service/level/resource) and level inference.

import { useMemo } from "react";

import { displayServiceName } from "@/shared/lib/service-name";
import { orpc } from "@/shared/server/orpc";

import { classifyLogSeverity } from "../components/log-severity";
import { useLogStream, type LogStreamStatus } from "./use-log-stream";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// INFO uses --primary so the log palette stays aligned with every other
// interactive accent in the app. One token, one place to tweak.
export const LEVEL_TEXT: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-info",
  warn: "text-warning",
  error: "text-destructive",
};

/**
 * Message-body colors for rendered log ROWS. Info is the normal case, so it
 * reads in the terminal's plain foreground; a wall of accent-blue text is
 * noise, not signal. The level chips/badges keep LEVEL_TEXT: there the color
 * IS the label. Warn/error stay tinted in rows because they are the outliers
 * an operator scans for.
 */
export const LEVEL_ROW_TEXT: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-terminal-foreground",
  warn: "text-warning",
  error: "text-destructive",
};

export const LEVEL_STRIPE: Record<LogLevel, string> = {
  debug: "bg-muted-foreground/40",
  info: "bg-info",
  warn: "bg-warning",
  error: "bg-destructive",
};

export interface LogLine {
  id: string;
  ts: string;
  tsIso: string | null;
  /** Epoch ms of `tsIso`, parsed ONCE at ingest. The time-range filter and
   *  histogram bucketing run over the whole buffer per frame while tailing,
   *  and re-parsing ISO strings there dominated the profile. */
  tsMs: number | null;
  level: LogLevel;
  svc: string;
  resourceId: string;
  stream: "stdout" | "stderr" | "system";
  msg: string;
  /** Lowercased `msg`, computed once at ingest for the same reason: the text
   *  filter otherwise allocated a lowercased copy of every message per pass. */
  msgLower: string;
}

interface UseProjectLogStreamArgs {
  projectId: string;
  // Optional whitelist: when undefined, follows every service in the project.
  resourceIds?: string[];
  paused: boolean;
  bufferSize?: number;
}

/** Level from the line's CONTENT first (shared heuristic with the build-log
 *  viewer: catches `TypeError`, `Failed …`, `⨯`, stack frames), falling back
 *  to the stream only when the content says nothing. A bare `\bERROR\b` check
 *  here used to miss `TypeError: …`/`Failed to …` lines entirely, painting
 *  real exceptions as stderr-warnings. */
function inferLevel(stream: "stdout" | "stderr" | "system", line: string): LogLevel {
  if (stream === "system") return "debug";
  if (line.startsWith("panic:")) return "error";
  const severity = classifyLogSeverity(line);
  if (severity === "error") return "error";
  if (severity === "warn") return "warn";
  // A line that declared itself INFO (or read as success) is not a warning just
  // because the tool writes its narration to stderr; only genuinely unclassified
  // stderr output gets the benefit of the doubt.
  if (severity === "info" || severity === "success") return "info";
  return stream === "stderr" ? "warn" : "info";
}

// Multi-line log output (stack traces, pretty-printed error objects) reaches us
// as one docker event *per physical line*: `timestamps=true` stamps each one.
// Indented lines and lone closing brackets are continuations of the entry above
// them, not new events, so fold them in rather than spawning a row each.
function isContinuationLine(msg: string): boolean {
  return /^\s/.test(msg) || /^[)\]}]+[,;]?\s*$/.test(msg) || msg === "";
}

// Collapse continuation lines into the preceding entry (same resource only, so
// interleaved services don't bleed into each other). The head line keeps its
// level/timestamp/id; the block renders as one expandable, multi-line entry.
function coalesceMultiline(lines: LogLine[]): LogLine[] {
  const out: LogLine[] = [];
  for (const ln of lines) {
    const head = out.length ? out[out.length - 1] : null;
    if (head && head.resourceId === ln.resourceId && isContinuationLine(ln.msg)) {
      out[out.length - 1] = {
        ...head,
        msg: `${head.msg}\n${ln.msg}`,
        msgLower: `${head.msgLower}\n${ln.msgLower}`,
      };
    } else {
      out.push(ln);
    }
  }
  return out;
}

function shortTs(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 23);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function useProjectLogStream({
  projectId,
  resourceIds,
  paused,
  // Virtualized table keeps the DOM light, so we can afford a much deeper
  // scrollback than the old per-row-DOM list (which capped at 500).
  bufferSize = 5000,
}: UseProjectLogStreamArgs): { lines: LogLine[]; status: LogStreamStatus; clear: () => void } {
  // Key the resource list by sorted-join so resourceIds = [a, b] and [b, a]
  // don't trigger reconnects.
  const key = resourceIds ? resourceIds.toSorted().join(",") : "";

  const {
    lines: rawLines,
    status,
    clear,
  } = useLogStream({
    // No client retry plugin here. useLogStream owns reconnects so a reopen
    // keeps the buffer intact and requests NO backfill (tail: 0), instead of
    // the plugin's transparent re-invoke duplicating 50 lines per service.
    open: (signal, initial) =>
      orpc.project.logs.tail.call(
        {
          projectId,
          resourceIds: resourceIds ?? undefined,
          tail: initial ? 50 : 0,
        },
        { signal },
      ),
    map: (ev, id): LogLine => {
      const tsMs = ev.ts ? Date.parse(ev.ts) : NaN;
      return {
        id: String(id),
        ts: shortTs(ev.ts),
        tsIso: ev.ts,
        tsMs: Number.isNaN(tsMs) ? null : tsMs,
        level: inferLevel(ev.stream, ev.line),
        svc: ev.serviceName ? displayServiceName(ev.serviceName) : "system",
        resourceId: ev.resourceId,
        stream: ev.stream,
        msg: ev.line,
        msgLower: ev.line.toLowerCase(),
      };
    },
    onError: (err, id): LogLine => {
      const now = new Date();
      const msg = `Log stream error: ${err instanceof Error ? err.message : String(err)}`;
      return {
        id: `err-${id}`,
        ts: shortTs(now.toISOString()),
        tsIso: now.toISOString(),
        tsMs: now.getTime(),
        level: "error",
        svc: "system",
        resourceId: "",
        stream: "system",
        msg,
        msgLower: msg.toLowerCase(),
      };
    },
    bufferSize,
    paused,
    key: `${projectId}|${key}|${bufferSize}`,
  });

  // Memoized on the buffer snapshot: without this, every render (frame,
  // during tail) allocated a fresh array + fresh folded objects, which broke
  // referential identity for EVERY downstream useMemo (filters, react-table
  // row models, histogram buckets) and re-processed the whole 5k buffer 4-5
  // times per frame.
  const lines = useMemo(() => coalesceMultiline(rawLines), [rawLines]);
  return { lines, status, clear };
}
