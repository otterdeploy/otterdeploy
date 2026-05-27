// Live tail of every service log in a project. Ringbuffered client-side so
// the page stays responsive even on chatty stacks; filtering / search runs
// against this buffer, so anything dropped here is gone from the UI too.
//
// `paused` keeps the existing buffer but suspends new pushes — flips back to
// live without dropping rows, so the operator can scroll back to read.

import { useEffect, useRef, useState } from "react";

import { orpc } from "@/shared/server/orpc";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

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

type Status = "connecting" | "live" | "ended" | "error";

function inferLevel(stream: "stdout" | "stderr" | "system", line: string): LogLevel {
  if (stream === "system") return "debug";
  if (/\b(ERROR|FATAL|PANIC)\b/i.test(line) || line.startsWith("panic:")) {
    return "error";
  }
  if (/\bWARN(ING)?\b/i.test(line)) return "warn";
  return stream === "stderr" ? "warn" : "info";
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
  bufferSize = 500,
}: UseProjectLogStreamArgs) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const counterRef = useRef(0);

  // Key the resource list by sorted-join so resourceIds = [a, b] and [b, a]
  // don't trigger reconnects.
  const key = resourceIds ? [...resourceIds].sort().join(",") : "";

  useEffect(() => {
    const ctrl = new AbortController();
    setLines([]);
    setStatus("connecting");
    counterRef.current = 0;

    void (async () => {
      try {
        const stream = await orpc.project.logs.tail.call(
          {
            projectId: projectId as never,
            resourceIds: (resourceIds ?? undefined) as never,
            tail: 50,
          },
          { signal: ctrl.signal },
        );
        setStatus("live");
        for await (const ev of stream) {
          if (ctrl.signal.aborted) break;
          if (pausedRef.current) continue;
          const ln: LogLine = {
            id: `${Date.now().toString(36)}-${counterRef.current++}`,
            ts: shortTs(ev.ts),
            tsIso: ev.ts,
            level: inferLevel(ev.stream, ev.line),
            svc: ev.serviceName || "system",
            resourceId: ev.resourceId,
            stream: ev.stream,
            msg: ev.line,
          };
          setLines((prev) =>
            prev.length >= bufferSize ? [...prev.slice(-bufferSize + 1), ln] : [...prev, ln],
          );
        }
        if (!ctrl.signal.aborted) setStatus("ended");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setStatus("error");
        const msg = err instanceof Error ? err.message : String(err);
        setLines((prev) => [
          ...prev,
          {
            id: `err-${counterRef.current++}`,
            ts: shortTs(new Date().toISOString()),
            tsIso: new Date().toISOString(),
            level: "error",
            svc: "system",
            resourceId: "",
            stream: "system",
            msg: `Log stream error: ${msg}`,
          },
        ]);
      }
    })();

    return () => ctrl.abort();
  }, [projectId, key, bufferSize, resourceIds]);

  return { lines, status };
}
