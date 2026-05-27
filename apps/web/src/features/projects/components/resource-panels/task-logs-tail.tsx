/**
 * Live stdout/stderr stream for one swarm task — used by the deployment
 * detail expander. Mirrors the resource-wide ResourceLogsTab semantics
 * but scoped to a single task (no replay across replicas).
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

type Status = "connecting" | "live" | "ended" | "error";

interface TaskLogsTailProps {
  projectId: string;
  resourceId: string;
  taskId: string;
}

export function TaskLogsTail({ projectId, resourceId, taskId }: TaskLogsTailProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const counterRef = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLines([]);
    setStatus("connecting");
    counterRef.current = 0;

    (async () => {
      try {
        const stream = await orpc.project.resource.taskLogs.tail.call(
          {
            projectId: projectId as never,
            resourceId: resourceId as never,
            taskId,
            tail: 500,
          },
          { signal: ctrl.signal },
        );
        setStatus("live");
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;
          setLines((prev) => [
            ...prev,
            {
              id: ++counterRef.current,
              stream: event.stream,
              line: event.line,
              ts: event.ts,
            },
          ]);
        }
        if (!ctrl.signal.aborted) setStatus("ended");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setStatus("error");
        setLines((prev) => [
          ...prev,
          {
            id: ++counterRef.current,
            stream: "system",
            line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            ts: new Date().toISOString(),
          },
        ]);
      }
    })();

    return () => ctrl.abort();
  }, [projectId, resourceId, taskId]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          Task logs
        </span>
        <LogStreamStatus status={status} />
      </div>
      <div className="max-h-[260px] overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60">
            {status === "connecting" ? "Loading task logs…" : "No output."}
          </div>
        ) : (
          lines.map((l) => <LogRow key={l.id} line={l} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const tone =
    line.stream === "stderr"
      ? "text-destructive/90"
      : line.stream === "system"
        ? "text-muted-foreground italic"
        : "text-foreground/85";
  return (
    <div className={cn("flex gap-3", tone)}>
      {line.ts && (
        <span className="shrink-0 text-muted-foreground/50">
          {line.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
        </span>
      )}
      <span className="break-all whitespace-pre-wrap">{line.line}</span>
    </div>
  );
}

function LogStreamStatus({ status }: { status: Status }) {
  const { dot, label } =
    status === "live"
      ? { dot: "bg-success", label: "live" }
      : status === "connecting"
        ? { dot: "bg-warning animate-pulse", label: "connecting" }
        : status === "ended"
          ? { dot: "bg-muted-foreground/40", label: "ended" }
          : { dot: "bg-destructive", label: "error" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}
