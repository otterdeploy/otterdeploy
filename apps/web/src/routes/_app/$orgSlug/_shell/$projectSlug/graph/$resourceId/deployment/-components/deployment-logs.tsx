import { LogViewer, type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { orpc } from "@/shared/server/orpc";

// ─── Deploy Logs tab ──────────────────────────────────────────────────────

export function DeploymentLogsBody({
  projectId,
  resourceId,
  deploymentId,
}: {
  projectId: string;
  resourceId: string;
  deploymentId: string;
}) {
  const { lines, status } = useLogStream({
    open: (signal) =>
      orpc.project.resource.deployments.logs.tail.call(
        {
          projectId,
          resourceId,
          deploymentId,
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
    deps: [projectId, resourceId, deploymentId],
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <LogViewer
        lines={lines}
        empty={
          <LogEmpty
            title={
              status === "connecting" ? "Loading deployment logs…" : "No logs in this time range"
            }
            hint="Logs will show up here as they are found."
          />
        }
      />
    </div>
  );
}

// ─── Build logs tab ───────────────────────────────────────────────────────

export function BuildLogsBody({ deploymentId }: { deploymentId: string }) {
  // Build pipeline logs come from apps/builder via Redis pub/sub +
  // deployment_log, streamed over the oRPC event-iterator
  // (project.resource.deployments.buildLogs.stream). `context.retry` opts
  // this call into the client retry plugin's auto-reconnect; on reconnect
  // the server resumes from the last seen seq via lastEventId.
  const { lines, status } = useLogStream({
    open: (signal) =>
      orpc.project.resource.deployments.buildLogs.stream.call(
        { deploymentId },
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
      stream: "stderr",
      line: `Build log stream error: ${err instanceof Error ? err.message : String(err)}`,
      ts: new Date().toISOString(),
    }),
    deps: [deploymentId],
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <LogViewer
        lines={lines}
        empty={
          <LogEmpty
            title={
              status === "connecting"
                ? "Connecting to build log stream…"
                : status === "error"
                  ? "Stream disconnected"
                  : "No build output yet"
            }
            hint="Lines appear here as the builder runs."
          />
        }
      />
    </div>
  );
}

// ─── HTTP / Network placeholders ─────────────────────────────────────────
// Distinct components rather than a generic message so each can grow its
// own real-data wiring without changing the page layout.

export function NotImplementedTab({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return <EmptyTab title={title} hint={hint} />;
}

function EmptyTab({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid h-full place-items-center rounded-md border bg-[oklch(0.12_0_0)] p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <div className="text-[14px] font-medium text-foreground/80">
          {title}
        </div>
        <div className="text-[12px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

// Centered empty/loading copy rendered inside a LogViewer's scroller.
function LogEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="text-[14px] font-medium text-foreground/80">{title}</div>
        <div className="text-[12px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}
