/**
 * Server-side implementation of the deployment build-log stream.
 *
 * An async generator scoped to one deployment, with org membership as the auth
 * boundary. Yields scrollback from `deployment_log` immediately, then live-tails
 * by POLLING `deployment_log` for newly-inserted rows until the deployment
 * reaches a terminal state.
 *
 * Why polling, not Redis pub/sub:
 *   This used to `SUBSCRIBE` to the builder's Redis channel first and only THEN
 *   run the scrollback query. But Bun's RedisClient can drop/hang its
 *   subscribe promise on a cold connect (the same 1.3.x flakiness the builder's
 *   warmUpClients guards against). Because scrollback was awaited BEHIND that
 *   subscribe, the whole backfill stalled for in-progress (non-terminal)
 *   deployments — the logs only appeared once the build went terminal (which
 *   skips the subscribe). Polling the DB the builder already writes to every
 *   ~250ms is reliable, needs no second Redis client, and tails near-live.
 *   Every line carries its DB `seq` as the event id, so a client reconnect
 *   resumes via `lastEventId` without replaying the whole log.
 */
import type { DeploymentId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, deploymentLog, resource, project } from "@otterdeploy/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";

type OrgId = OrganizationId;
type LogPhase = "build" | "deploy";

/** Poll cadence for new log rows. The builder flushes inserts every ~250ms, so
 *  ~500ms tails near-live without hammering the DB. */
const POLL_INTERVAL_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  /** Resume cursor from the client's `lastEventId` — skip scrollback rows at
   *  or before this seq so a reconnect doesn't replay the whole log. */
  afterSeq?: number | null;
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
      and(eq(deployment.id, input.deploymentId), eq(project.organizationId, input.organizationId)),
    )
    .limit(1);
  return row ?? null;
}

/** Fetch log rows for one phase with seq strictly greater than `afterSeq` (0 →
 *  all rows, since seq starts at 1), oldest-first. */
export async function fetchLogsAfter(
  deploymentId: DeploymentId,
  afterSeq: number,
  phase: LogPhase,
): Promise<DeploymentLogLine[]> {
  const rows = await db
    .select({
      seq: deploymentLog.seq,
      stream: deploymentLog.stream,
      line: deploymentLog.line,
      ts: deploymentLog.ts,
    })
    .from(deploymentLog)
    .where(
      and(
        eq(deploymentLog.deploymentId, deploymentId),
        eq(deploymentLog.phase, phase),
        gt(deploymentLog.seq, afterSeq),
      ),
    )
    .orderBy(asc(deploymentLog.seq))
    // Bypass the global query cache: a live tail must read fresh rows every
    // poll, not a 60s-TTL snapshot that would hide new lines.
    .$withCache(false);
  return rows.map((r) => ({ seq: r.seq, stream: r.stream, line: r.line, ts: r.ts.toISOString() }));
}

/** Current lifecycle status, or null if the row vanished (deleted mid-stream). */
async function currentStatus(deploymentId: DeploymentId): Promise<string | null> {
  const [row] = await db
    .select({ status: deployment.status })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .limit(1)
    // Fresh read — a cached status would keep the tail polling after the build
    // already reached a terminal state (or end it early on a stale terminal).
    .$withCache(false);
  return row?.status ?? null;
}

export async function* streamDeploymentLogs(
  input: StreamInput,
): AsyncGenerator<DeploymentLogLine, void, undefined> {
  const auth = await authorizeDeployment(input);
  if (!auth) return;

  // Resume cursor: yield only rows after this seq (0 ⇒ from the top).
  let lastSeq =
    typeof input.afterSeq === "number" && Number.isFinite(input.afterSeq) ? input.afterSeq : 0;

  // Scrollback FIRST — renders the existing log immediately, with no Redis
  // dependency in the critical path.
  for (const line of await fetchLogsAfter(input.deploymentId, lastSeq, "build")) {
    if (line.seq != null) lastSeq = line.seq;
    yield line;
  }

  // Terminal deployments produce no further output.
  if (TERMINAL_STATUSES.has(auth.deployment.status)) return;

  // Live-tail by polling for newly-inserted rows until terminal. On the poll
  // that observes a terminal status, drain once more so lines flushed right at
  // completion aren't dropped.
  while (true) {
    await sleep(POLL_INTERVAL_MS);
    for (const line of await fetchLogsAfter(input.deploymentId, lastSeq, "build")) {
      if (line.seq != null) lastSeq = line.seq;
      yield line;
    }
    const status = await currentStatus(input.deploymentId);
    if (status == null || TERMINAL_STATUSES.has(status)) {
      for (const line of await fetchLogsAfter(input.deploymentId, lastSeq, "build")) {
        if (line.seq != null) lastSeq = line.seq;
        yield line;
      }
      return;
    }
  }
}
