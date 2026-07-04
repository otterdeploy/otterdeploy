// Live tail of every service log in a project. Ringbuffered client-side so
// the page stays responsive even on chatty stacks; filtering / search runs
// against this buffer, so anything dropped here is gone from the UI too.
//
// `paused` keeps the existing buffer but suspends new pushes — flips back to
// live without dropping rows, so the operator can scroll back to read.
//
// Transport + buffering are the shared `useLogStream`; this hook only adds the
// project-fan-in line shape (service/level/resource) and level inference.

import { useMemo } from "react";

import { displayServiceName } from "@/shared/lib/service-name";
import { orpc } from "@/shared/server/orpc";

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
  level: LogLevel;
  svc: string;
  resourceId: string;
  stream: "stdout" | "stderr" | "system";
  msg: string;
}

interface UseProjectLogStreamArgs {
  projectId: string;
  // Optional whitelist — when undefined, follows every service in the project.
  resourceIds?: string[];
  paused: boolean;
  bufferSize?: number;
}

function inferLevel(stream: "stdout" | "stderr" | "system", line: string): LogLevel {
  if (stream === "system") return "debug";
  if (/\b(ERROR|FATAL|PANIC)\b/i.test(line) || line.startsWith("panic:")) {
    return "error";
  }
  if (/\bWARN(ING)?\b/i.test(line)) return "warn";
  return stream === "stderr" ? "warn" : "info";
}

// Multi-line log output (stack traces, pretty-printed error objects) reaches us
// as one docker event *per physical line* — `timestamps=true` stamps each one.
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
      out[out.length - 1] = { ...head, msg: `${head.msg}\n${ln.msg}` };
    } else {
      out.push(ln);
    }
  }
  return out;
}

function shortTs(iso: string | null): string {
  if (!iso) return "—";
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
}: UseProjectLogStreamArgs): { lines: LogLine[]; status: LogStreamStatus } {
  // Key the resource list by sorted-join so resourceIds = [a, b] and [b, a]
  // don't trigger reconnects.
  const key = resourceIds ? [...resourceIds].sort().join(",") : "";

  const { lines: rawLines, status } = useLogStream({
    open: (signal) =>
      orpc.project.logs.tail.call(
        {
          projectId: projectId as never,
          resourceIds: (resourceIds ?? undefined) as never,
          tail: 50,
        },
        { signal, context: { retry: Number.POSITIVE_INFINITY } },
      ),
    map: (ev, id): LogLine => ({
      id: String(id),
      ts: shortTs(ev.ts),
      tsIso: ev.ts,
      level: inferLevel(ev.stream, ev.line),
      svc: ev.serviceName ? displayServiceName(ev.serviceName) : "system",
      resourceId: ev.resourceId,
      stream: ev.stream,
      msg: ev.line,
    }),
    onError: (err, id): LogLine => {
      const iso = new Date().toISOString();
      return {
        id: `err-${id}`,
        ts: shortTs(iso),
        tsIso: iso,
        level: "error",
        svc: "system",
        resourceId: "",
        stream: "system",
        msg: `Log stream error: ${err instanceof Error ? err.message : String(err)}`,
      };
    },
    bufferSize,
    paused,
    deps: [projectId, key, bufferSize],
  });

  const lines = useMemo(() => coalesceMultiline(rawLines), [rawLines]);
  return { lines, status };
}
