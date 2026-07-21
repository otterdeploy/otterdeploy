/**
 * Build/deploy log sink.
 *
 * Every line the build pipeline produces is fanned out to two places:
 *   1. The `deployment_log` table (persistent scrollback). Writes are
 *      batched — both by line count and by a short timeout — so a noisy
 *      build (e.g. `npm install` chatter) doesn't generate one INSERT per
 *      stdout chunk.
 *   2. A Redis pub/sub channel `deployment:{deploymentId}:logs` carrying
 *      one JSON-encoded line per message. The UI's WS endpoint
 *      subscribes here for the live tail.
 *
 * `system` lines are emitted by the builder itself (e.g. "starting
 * nixpacks build"); `stdout`/`stderr` are forwarded verbatim from
 * child processes.
 *
 * On close, any buffered lines are flushed and the Redis publisher is
 * disconnected.
 */

import type { DeploymentId } from "@otterdeploy/shared/id";
import type { RedisClient } from "bun";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema";
import { log as globalLog } from "evlog";

type Stream = "stdout" | "stderr" | "system";
/** Which half of the pipeline a line belongs to — drives which log tab shows
 *  it. The sink starts in `build`; the pipeline flips it to `deploy` once the
 *  image is ready and the rollout begins (see `setPhase`). */
type Phase = "build" | "deploy";

interface PendingLine {
  stream: Stream;
  phase: Phase;
  line: string;
  ts: Date;
}

const FLUSH_INTERVAL_MS = 250;
const FLUSH_BATCH_SIZE = 50;

export interface LogSink {
  write(stream: Stream, line: string): void;
  system(line: string): void;
  /** Switch the phase tag applied to all subsequent lines (build → deploy). */
  setPhase(phase: Phase): void;
  close(): Promise<void>;
}

export function createLogSink(opts: {
  deploymentId: DeploymentId;
  publisher: RedisClient;
}): LogSink {
  const channel = `deployment:${opts.deploymentId}:logs`;
  let buffer: PendingLine[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let currentPhase: Phase = "build";

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await db.insert(deploymentLog).values(
        batch.map((b) => ({
          deploymentId: opts.deploymentId,
          stream: b.stream,
          phase: b.phase,
          line: b.line,
          ts: b.ts,
        })),
      );
    } catch (err) {
      // Don't crash the build because the log DB is unavailable — but do
      // surface it. The pub/sub fan-out already happened (live viewers
      // see the line); we just lose scrollback for these rows.
      globalLog.error({
        build: { event: "log-flush-failed", deploymentId: opts.deploymentId },
        error: err instanceof Error ? err.message : String(err),
      } as Record<string, unknown>);
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
  }

  function append(stream: Stream, line: string) {
    if (closed) return;
    const ts = new Date();
    // Strip a single trailing newline so callers can pass raw lines
    // from a line-splitter without `\n` showing up in the DB column.
    const clean = line.endsWith("\n") ? line.slice(0, -1) : line;
    const phase = currentPhase;
    buffer.push({ stream, phase, line: clean, ts });
    // Fire-and-forget pub/sub — the subscriber side is allowed to be
    // absent (no live tail viewer), and a publish failure here is
    // never worth failing the build over.
    opts.publisher
      .publish(channel, JSON.stringify({ stream, phase, line: clean, ts: ts.toISOString() }))
      .catch((err) =>
        globalLog.warn({
          build: {
            event: "log-publish-failed",
            deploymentId: opts.deploymentId,
          },
          error: err instanceof Error ? err.message : String(err),
        } as Record<string, unknown>),
      );
    if (buffer.length >= FLUSH_BATCH_SIZE) {
      void flush();
    } else {
      schedule();
    }
  }

  return {
    write(stream, line) {
      append(stream, line);
    },
    system(line) {
      append("system", line);
    },
    setPhase(phase) {
      currentPhase = phase;
    },
    async close() {
      closed = true;
      await flush();
    },
  };
}
