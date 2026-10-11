/**
 * One SSH provisioning run, live: the runner's log lines as they stream, and
 * the persisted server row as the authoritative verdict.
 *
 * The log can miss everything when a run finishes before the stream attaches
 * (fast fail or complete); the row still records the outcome, so it is polled
 * until terminal. That is what keeps a fast failure from reading as a spinner
 * that never stops.
 */

import type { ServerId } from "@otterdeploy/shared/id";

import { useEffect } from "react";

import { useQuery } from "@tanstack/react-query";

import { useLogStream } from "@/features/logs/data/use-log-stream";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { ProvisionLine } from "../components/server-provision-stepper";

/**
 * Drop lines this view already has.
 *
 * `server.provisionLogs` replays its whole scrollback to every subscriber, and
 * the retry plugin's reconnect is a new subscription. A dropped connection, or
 * a hidden tab's released live socket coming back, used to append the run so
 * far a second time. A provision line carries its own timestamp, so the pair
 * identifies it.
 */
async function* onlyUnseen<T extends ProvisionLine>(stream: AsyncIterable<T>): AsyncGenerator<T> {
  const seen = new Set<string>();
  for await (const raw of stream) {
    const key = `${raw.ts}\u0000${raw.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    yield raw;
  }
}

type ProvisionOutcome = "running" | "ready" | "failed";

export function useProvisionRun(serverId: ServerId) {
  const { lines } = useLogStream<ProvisionLine, ProvisionLine & { seq: number }>({
    open: async (signal) =>
      onlyUnseen(
        await orpc.server.provisionLogs.call(
          { id: serverId },
          { signal, context: { retry: Number.POSITIVE_INFINITY } },
        ),
      ),
    map: (raw, seq) => ({ seq, line: raw.line, ts: raw.ts }),
    key: serverId,
    onError: (_err, seq) => ({ seq, line: "[stream disconnected]", ts: "" }),
  });

  const { data: row } = useQuery(
    orpc.server.get.queryOptions({
      input: { id: serverId },
      refetchInterval: (query) => {
        const s = query.state.data?.provisionStatus;
        return s === "ready" || s === "failed" ? false : 1500;
      },
    }),
  );

  const failed = lines.some((l) => l.line.startsWith("✗")) || row?.provisionStatus === "failed";
  const ready = lines.some((l) => l.line.startsWith("✓")) || row?.provisionStatus === "ready";
  const outcome: ProvisionOutcome = failed ? "failed" : ready ? "ready" : "running";

  // Refresh the servers grid once the run has an answer, from either signal.
  useEffect(() => {
    if (outcome !== "running") {
      void queryClient.invalidateQueries({ queryKey: orpc.server.list.queryKey() });
    }
  }, [outcome]);

  return { lines, row, outcome };
}
