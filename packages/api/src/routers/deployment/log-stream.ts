/**
 * Server-side implementation of the deployment build-log stream.
 *
 * Mirrors `streamProjectEvents` in shape: an async generator scoped to
 * one deployment, with org membership as the auth boundary. Yields
 * scrollback from `deployment_log` first, then live-tail messages
 * forwarded from the Redis pub/sub channel the builder publishes to
 * (see apps/builder/src/log-stream.ts).
 *
 * Live-vs-scrollback handoff:
 *   The builder publishes each line to Redis BEFORE the batched DB
 *   insert lands (the flush is 50-lines / 250ms). So we must
 *   `SUBSCRIBE` first, buffer everything that arrives, *then* run the
 *   scrollback query, *then* drain the buffer. A short overlap window
 *   means a line that's both already in scrollback and still in the
 *   buffer can appear twice — acceptable for an operational log view.
 *   Tightening would require an explicit dedup key (seq in the
 *   pub/sub payload), which the builder doesn't ship today.
 *
 * Terminal deployments (running/failed/superseded/removed) get
 * scrollback only — the generator returns immediately after.
 */

import { db } from "@otterstack/db";
import { deployment, deploymentLog, resource, project } from "@otterstack/db/schema";
import { type Id, ID_PREFIX as IDP } from "@otterstack/shared/id";
import { and, asc, eq } from "drizzle-orm";

import { createRedis } from "../../lib/redis";

type OrgId = Id<typeof IDP.organization>;
type DeploymentId = Id<typeof IDP.deployment>;

export interface DeploymentLogLine {
  /** Insert-order id for DB rows; null for live messages that haven't
   *  landed in the DB yet. */
  seq: number | null;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string;
}

interface StreamInput {
  deploymentId: DeploymentId;
  organizationId: OrgId;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "failed",
  "superseded",
  "removed",
]);

/**
 * Look up the deployment + verify the requesting org owns the
 * project it belongs to. Returns null when not found / not owned —
 * the caller closes the stream with an empty result, no info-leak.
 */
async function authorizeDeployment(input: StreamInput) {
  const [row] = await db
    .select({
      deployment,
      organizationId: project.organizationId,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(deployment.id, input.deploymentId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function* streamDeploymentLogs(
  input: StreamInput,
): AsyncGenerator<DeploymentLogLine, void, undefined> {
  const auth = await authorizeDeployment(input);
  if (!auth) return;

  const isTerminal = TERMINAL_STATUSES.has(auth.deployment.status);

  // Subscribe FIRST, then run scrollback — see file header comment.
  const subscriber = isTerminal ? null : createRedis();
  const channel = `deployment:${input.deploymentId}:logs`;
  const liveBuffer: DeploymentLogLine[] = [];
  let resolveLive: (() => void) | null = null;

  if (subscriber) {
    await subscriber.subscribe(channel, (payload) => {
      try {
        const parsed = JSON.parse(payload) as {
          stream: DeploymentLogLine["stream"];
          line: string;
          ts: string;
        };
        liveBuffer.push({ seq: null, ...parsed });
        if (resolveLive) {
          const r = resolveLive;
          resolveLive = null;
          r();
        }
      } catch {
        // Skip malformed payloads; the builder is the only writer
        // and uses JSON.stringify, so this is defensive only.
      }
    });
  }

  try {
    const scrollback = await db
      .select({
        seq: deploymentLog.seq,
        stream: deploymentLog.stream,
        line: deploymentLog.line,
        ts: deploymentLog.ts,
      })
      .from(deploymentLog)
      .where(eq(deploymentLog.deploymentId, input.deploymentId))
      .orderBy(asc(deploymentLog.seq));

    for (const row of scrollback) {
      yield {
        seq: row.seq,
        stream: row.stream,
        line: row.line,
        ts: row.ts.toISOString(),
      };
    }

    if (!subscriber) return;

    // Live-tail loop. `resolveLive` is signalled by the subscriber
    // callback when a new line arrives. On each wakeup we drain the
    // buffer and wait for the next.
    while (true) {
      if (liveBuffer.length === 0) {
        await new Promise<void>((res) => {
          resolveLive = res;
        });
      }
      const drain = liveBuffer.splice(0, liveBuffer.length);
      for (const line of drain) yield line;
    }
  } finally {
    if (subscriber) {
      await subscriber.unsubscribe(channel).catch(() => undefined);
      subscriber.close();
    }
  }
}
