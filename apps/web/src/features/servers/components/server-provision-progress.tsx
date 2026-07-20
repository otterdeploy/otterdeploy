import type { ServerId } from "@otterdeploy/shared/id";

import { useEffect, useRef } from "react";

import { useQuery } from "@tanstack/react-query";

import { useLogStream } from "@/features/logs/data/use-log-stream";
import { Button } from "@/shared/components/ui/button";
import { DialogFooter } from "@/shared/components/ui/dialog";
import { orpc, queryClient } from "@/shared/server/orpc";

import { ProvisionStepper } from "./server-provision-stepper";

function lineClass(line: string): string {
  if (line.startsWith("✗")) return "text-red-500";
  if (line.startsWith("✓")) return "text-emerald-500";
  if (line.startsWith("──")) return "text-foreground";
  return "text-muted-foreground";
}

export function ProvisionProgress({
  serverId,
  onClose,
}: {
  serverId: ServerId;
  onClose: () => void;
}) {
  const { lines, status } = useLogStream<
    { line: string; ts: string },
    { seq: number; line: string }
  >({
    open: (signal) =>
      orpc.server.provisionLogs.call(
        { id: serverId },
        { signal, context: { retry: Number.POSITIVE_INFINITY } },
      ),
    map: (raw, seq) => ({ seq, line: raw.line }),
    deps: [serverId],
    onError: (_err, seq) => ({ seq, line: "— stream disconnected —" }),
  });

  // Authoritative terminal state. The live log can miss everything when the run
  // finishes before the stream attaches (fast fail/complete); the persisted
  // row still records the verdict, so poll it until terminal. This is what
  // stops the old "connecting…" spinner from hanging forever.
  const { data: row } = useQuery(
    orpc.server.get.queryOptions({
      input: { id: serverId },
      refetchInterval: (query) => {
        const s = query.state.data?.provisionStatus;
        return s === "ready" || s === "failed" ? false : 1500;
      },
    }),
  );

  const rawLines = lines.map((l) => l.line);
  const streamFailed = rawLines.some((l) => l.startsWith("✗"));
  const streamDone = rawLines.some((l) => l.startsWith("✓"));
  const failed = streamFailed || row?.provisionStatus === "failed";
  const done = streamDone || row?.provisionStatus === "ready";
  const finished = done || failed || status === "ended";

  // Refresh the servers table once the run reaches a terminal state — from
  // either signal (stream end or the polled row).
  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: orpc.server.list.queryKey() });
    }
  }, [finished]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length]);

  return (
    <div className="flex flex-col gap-4">
      <ProvisionStepper lines={rawLines} row={row} />

      <details className="group rounded-md ring-1 ring-foreground/10">
        <summary className="cursor-pointer select-none px-3 py-2 text-[12px] text-muted-foreground marker:text-muted-foreground">
          Raw log
        </summary>
        <div
          ref={scrollRef}
          className="max-h-56 overflow-y-auto border-t border-foreground/10 bg-foreground/[0.03] p-3 font-mono text-[12px] leading-relaxed"
        >
          {rawLines.length === 0 ? (
            <span className="text-muted-foreground">
              {finished ? "No log captured." : "connecting…"}
            </span>
          ) : (
            lines.map((l) => (
              <div key={l.seq} className={lineClass(l.line)}>
                {l.line}
              </div>
            ))
          )}
        </div>
      </details>

      <DialogFooter className="flex-row items-center sm:justify-between">
        <span className="text-[12px] text-muted-foreground">
          {done
            ? "Server ready."
            : failed
              ? "Provisioning failed — fix the issue and retry from the servers table."
              : status === "ended"
                ? "Finished."
                : "Provisioning…"}
        </span>
        <Button size="sm" className="h-8" type="button" onClick={onClose}>
          {finished ? "Close" : "Run in background"}
        </Button>
      </DialogFooter>
    </div>
  );
}
