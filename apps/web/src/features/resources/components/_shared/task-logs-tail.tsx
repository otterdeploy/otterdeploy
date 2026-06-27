/**
 * Live stdout/stderr stream for one swarm task — used by the deployment
 * detail expander. Mirrors the resource-wide ResourceLogsTab semantics
 * but scoped to a single task (no replay across replicas).
 *
 * Connection + line accumulation come from the shared `useLogStream`; this
 * file only owns its compact layout (fixed-height pane + a status dot).
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream, type LogStreamStatus } from "@/features/logs/data/use-log-stream";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

interface TaskLogsTailProps {
  projectId: ProjectId;
  resourceId: ResourceId;
  taskId: string;
}

function TaskLogsTail({ projectId, resourceId, taskId }: TaskLogsTailProps) {
  const { lines, status } = useLogStream({
    open: (signal) =>
      orpc.project.resource.taskLogs.tail.call(
        {
          projectId,
          resourceId,
          taskId,
          tail: 500,
        },
        { signal, context: { retry: Number.POSITIVE_INFINITY } },
      ),
    map: (e, id): LogLine => ({
      id,
      stream: e.stream,
      line: e.line,
      ts: e.ts,
    }),
    onError: (err, id): LogLine => ({
      id,
      stream: "system",
      line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      ts: new Date().toISOString(),
    }),
    deps: [projectId, resourceId, taskId],
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground/70 uppercase">
          Task logs
        </span>
        <LogStreamStatusDot status={status} />
      </div>
      <div className="max-h-[260px] overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60">
            {status === "connecting" ? "Loading task logs…" : "No output."}
          </div>
        ) : (
          lines.map((l) => <LogLineRow key={l.id} line={l} />)
        )}
      </div>
    </div>
  );
}

function LogStreamStatusDot({ status }: { status: LogStreamStatus }) {
  const label =
    status === "live"
      ? "live"
      : status === "connecting"
        ? "connecting"
        : status === "ended"
          ? "ended"
          : "error";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn("size-1.5 rounded-full", {
          "bg-destructive": status === "error",
          "bg-success": status === "live",
          "animate-pulse bg-warning": status === "connecting",
          "bg-muted-foreground/40": status === "ended",
        })}
      />
      {label}
    </span>
  );
}
