import type { ServerId } from "@otterdeploy/shared/id";

import { useEffect, useRef } from "react";

import { useLogStream } from "@/features/logs/data/use-log-stream";
import { Button } from "@/shared/components/ui/button";
import { DialogFooter } from "@/shared/components/ui/dialog";
import { orpc, queryClient } from "@/shared/server/orpc";

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

  // Once the stream ends the row reached a terminal state — refresh the table.
  useEffect(() => {
    if (status === "ended") {
      void queryClient.invalidateQueries({ queryKey: orpc.server.list.queryKey() });
    }
  }, [status]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines.length]);

  const failed = lines.some((l) => l.line.startsWith("✗"));
  const done = lines.some((l) => l.line.startsWith("✓"));
  const finished = done || failed || status === "ended";

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={scrollRef}
        className="h-72 overflow-y-auto rounded-md bg-foreground/[0.03] p-3 font-mono text-[12px] leading-relaxed ring-1 ring-foreground/10"
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground">connecting…</span>
        ) : (
          lines.map((l) => (
            <div key={l.seq} className={lineClass(l.line)}>
              {l.line}
            </div>
          ))
        )}
      </div>

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
