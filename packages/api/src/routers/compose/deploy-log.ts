/**
 * Deploy log for the DIRECT (image-only) compose path. The builder writes
 * `deployment_log` scrollback + Redis live-tail for git/build stacks, but a
 * direct `deployCompose` used to write nothing — the stack deployment's log
 * view rendered empty and the rollout was undiagnosable from the UI.
 *
 * Mirrors apps/builder/src/log-stream.ts in miniature: each line is published
 * to `deployment:{id}:logs` immediately (live tail) and appended to
 * `deployment_log` (scrollback). Volume is a handful of system lines per
 * deploy, so writes go through a simple ordered chain instead of batching.
 * Best-effort throughout — a log failure must never fail a deploy.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema/build";
import { log as globalLog } from "evlog";

import { createRedis } from "../../lib/redis";

export interface StackDeployLog {
  /** Append one system line (non-blocking; ordering preserved). */
  line(line: string): void;
  /** Flush pending writes and release the Redis publisher. */
  close(): Promise<void>;
}

/** A no-op log for callers that don't track a deployment row. */
export const nullStackDeployLog: StackDeployLog = {
  line: () => undefined,
  close: async () => undefined,
};

export function createStackDeployLog(deploymentId: DeploymentId): StackDeployLog {
  const channel = `deployment:${deploymentId}:logs`;
  const publisher = createRedis();
  let chain: Promise<void> = Promise.resolve();

  return {
    line(line: string) {
      const ts = new Date();
      // Fire-and-forget pub/sub — a missing live viewer or a publish failure
      // is never worth failing the deploy over.
      publisher
        .publish(channel, JSON.stringify({ stream: "system", line, ts: ts.toISOString() }))
        .catch(() => undefined);
      chain = chain
        .then(() =>
          db
            .insert(deploymentLog)
            .values({ deploymentId, stream: "system", line, ts })
            .then(() => undefined),
        )
        .catch((err) => {
          globalLog.warn({
            compose: { event: "deploy-log-write-failed", deploymentId },
            error: err instanceof Error ? err.message : String(err),
          } as Record<string, unknown>);
        });
    },
    async close() {
      await chain;
      publisher.close();
    },
  };
}
