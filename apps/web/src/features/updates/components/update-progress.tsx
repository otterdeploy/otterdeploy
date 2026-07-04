import { useEffect, useRef } from "react";

/**
 * Live progress pane for an in-flight platform update. Streams the server's
 * `system.progress` event-iterator into the shared log viewer. On a real cutover
 * the server is replaced mid-update, so this also polls /api/health until the
 * NEW container answers with the target version, then hard-reloads.
 */
import { env } from "@otterdeploy/env/web";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll the control plane until the new container reports the target version,
 *  then reload onto the updated dashboard. Real-cutover recovery only. */
function useCutoverRecovery(target: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      await sleep(6000);
      while (!cancelled) {
        try {
          const r = await fetch(`${env.VITE_SERVER_URL}/api/health`, { cache: "no-store" });
          if (r.ok) {
            const body = (await r.json()) as { version?: string };
            if (body.version === target) {
              window.location.reload();
              return;
            }
          }
        } catch {
          // control plane still down — keep polling.
        }
        await sleep(3000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [target, enabled]);
}

export function UpdateProgress({
  target,
  dryRun,
  onDone,
}: {
  target: string;
  dryRun: boolean;
  onDone: () => void;
}) {
  const { lines, status } = useLogStream({
    open: (signal) =>
      orpc.system.progress.call(
        {},
        // Real cutover: retry so the stream reconnects across the restart.
        // Dry-run completes in one pass, so no retry.
        { signal, context: { retry: dryRun ? 0 : Number.POSITIVE_INFINITY } },
      ),
    map: (e, id): LogLine => ({
      id,
      stream: e.level === "error" ? "stderr" : "system",
      line: e.message,
      ts: e.ts,
    }),
    onError: (err, id): LogLine => ({
      id,
      stream: "stderr",
      line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      ts: new Date().toISOString(),
    }),
    deps: [target, dryRun],
  });

  useCutoverRecovery(target, !dryRun);

  // Fixed-height pane that follows the tail: stick to the bottom as lines stream
  // in, so the log doesn't grow/jump under the buttons.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const done = dryRun && status === "ended";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground/70 uppercase">
          {dryRun ? "Simulating update" : "Updating"} → {target}
        </span>
        {!done && status !== "error" && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-warning" />
            {dryRun ? "running" : "applying"}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="h-[320px] overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-2.5 font-mono text-[11px] leading-relaxed text-foreground/85"
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60">Starting…</div>
        ) : (
          lines.map((l) => <LogLineRow key={l.id} line={l} />)
        )}
      </div>

      {done && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-success">
            Simulated update complete. No containers were changed.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      )}
      {!dryRun && (
        <span className="text-[11.5px] text-muted-foreground/70">
          Waiting for the control plane to come back on {target}. This page will reload
          automatically.
        </span>
      )}
    </div>
  );
}
