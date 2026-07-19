import { useEffect, useRef, useState } from "react";

/**
 * Live progress pane for an in-flight platform update. Streams the server's
 * `system.progress` event-iterator into the shared log viewer, renders the
 * update phases as a stepper, and offers a reset for a stuck run. On a real
 * cutover the server is replaced mid-update, so this also polls /api/health
 * until the NEW container answers with the target version, then hard-reloads —
 * or, if the persisted run turns `failed` (the helper died without cutting
 * over), stops waiting and surfaces the error.
 */
import { env } from "@otterdeploy/env/web";
import { toast } from "sonner";

import { LogLineRow, type LogLine } from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

import { useCancelUpdate, useUpdateState } from "../data/use-update-status";

type UpdatePhase = "validate" | "pull" | "migrate" | "recreate" | "handoff" | "done";

/** Visible steps in order. `handoff` folds into `recreate` for display — it's
 *  the same "restarting the control plane" beat. */
const STEPS: { key: Exclude<UpdatePhase, "handoff">; label: string }[] = [
  { key: "validate", label: "Validate" },
  { key: "pull", label: "Pull" },
  { key: "migrate", label: "Migrate" },
  { key: "recreate", label: "Recreate" },
  { key: "done", label: "Done" },
];

function phaseIndex(p: UpdatePhase): number {
  const key = p === "handoff" ? "recreate" : p;
  const i = STEPS.findIndex((s) => s.key === key);
  return i < 0 ? 0 : i;
}

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

function PhaseStepper({ current, failed }: { current: number; failed: boolean }) {
  return (
    <ol className="flex items-center gap-1.5 text-[10px] font-medium">
      {STEPS.map((step, i) => {
        const done = i < current || (!failed && current === STEPS.length - 1 && i === current);
        const active = i === current && !done;
        const errored = failed && i === current;
        return (
          <li key={step.key} className="flex min-w-0 items-center gap-1.5">
            <span
              className={
                errored
                  ? "size-1.5 rounded-full bg-destructive"
                  : done
                    ? "size-1.5 rounded-full bg-success"
                    : active
                      ? "size-1.5 animate-pulse rounded-full bg-warning"
                      : "size-1.5 rounded-full bg-muted-foreground/25"
              }
            />
            <span
              className={
                errored
                  ? "text-destructive"
                  : done || active
                    ? "text-foreground/80"
                    : "text-muted-foreground/50"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
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
  const [phase, setPhase] = useState<UpdatePhase>("validate");
  const runState = useUpdateState();
  const cancel = useCancelUpdate();

  // Reset the stepper when we (re)attach to a different run.
  useEffect(() => setPhase("validate"), [target, dryRun]);

  const { lines, status: streamStatus } = useLogStream({
    open: (signal) =>
      orpc.system.progress.call(
        {},
        // Real cutover: retry so the stream reconnects across the restart.
        // Dry-run completes in one pass, so no retry.
        { signal, context: { retry: dryRun ? 0 : Number.POSITIVE_INFINITY } },
      ),
    map: (e, id): LogLine => {
      setPhase(e.phase);
      return {
        id,
        stream: e.level === "error" ? "stderr" : "system",
        line: e.message,
        ts: e.ts,
      };
    },
    onError: (err, id): LogLine => ({
      id,
      stream: "stderr",
      line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      ts: new Date().toISOString(),
    }),
    deps: [target, dryRun],
  });

  const failed = runState.data?.status === "failed";
  const dryDone = dryRun && streamStatus === "ended" && !failed;
  const realDone = !dryRun && runState.data?.status === "succeeded";
  const done = dryDone || realDone;
  const terminal = done || failed;

  // Stop the /health wait once we know the run failed (the helper died without
  // cutting over, so the target will never come up).
  useCutoverRecovery(target, !dryRun && !failed && !realDone);

  const handleCancel = () => {
    cancel.mutate(
      {},
      {
        onSuccess: (res) => {
          toast.message(
            res.cancelled ? "Update reset — you can start it again." : "No update was running.",
          );
          onDone();
        },
        onError: (e) => toast.error(e.message ?? "Couldn't reset the update"),
      },
    );
  };

  // Fixed-height pane that follows the tail: stick to the bottom as lines stream
  // in, so the log doesn't grow/jump under the buttons.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground/70 uppercase">
          {dryRun ? "Simulating update" : "Updating"} → {target}
        </span>
        {!terminal && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-warning" />
            {dryRun ? "running" : "applying"}
          </span>
        )}
      </div>

      <PhaseStepper current={done ? STEPS.length - 1 : phaseIndex(phase)} failed={failed} />

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

      {failed && (
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12px] text-destructive">
            {runState.data?.error ?? "The update did not complete."}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Close
          </Button>
        </div>
      )}

      {dryDone && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-success">
            Simulated update complete. No containers were changed.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      )}

      {realDone && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-success">
            Update to {target} complete.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      )}

      {!dryRun && !terminal && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted-foreground/70">
            Waiting for the control plane to come back on {target}. This page will reload
            automatically.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={handleCancel}
            className="shrink-0 text-muted-foreground"
          >
            {cancel.isPending ? "Resetting…" : "Reset stuck update"}
          </Button>
        </div>
      )}
    </div>
  );
}
