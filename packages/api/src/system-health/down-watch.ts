import type { RedisClient } from "bun";

import { db } from "@otterdeploy/db";
import { deployment, preview, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
/**
 * Desired-vs-actual liveness: the watch that notices a service which SHOULD be
 * running and simply isn't.
 *
 * Everything else in the product observes liveness by being told, or by being
 * asked:
 *
 *   - deploy-crash-watcher.ts reacts to docker `die` events. It is push-based
 *     and in-memory, so a die that lands while the control plane is restarting
 *     (or while its own database is unwritable, which is what a full disk
 *     does) is a die nobody ever hears about.
 *   - metrics/health-detector.ts transitions on a container's healthcheck, and
 *     says so in its own header: a container that has dropped out of the
 *     running list entirely produces NO signal, and catching that "needs
 *     desired-vs-actual reconciliation".
 *   - deployments-list.ts derives `crashed`/`starting` live, but only when the
 *     UI reads the list. Nobody looking means nobody knows.
 *
 * Between them, silence was indistinguishable from health: a compose-member
 * Postgres died on a full disk and stayed dead for two days with its
 * deployment row still reading `running`, its stack's other containers
 * retry-looping against it, and not one notification anywhere. This is the
 * reconciliation those three leave out — it asks the runtime what is actually
 * up, compares it against what the database says should be up, and announces
 * the difference.
 *
 * Deliberate limits:
 *   - `compose` resources are never expected to have a container of their own
 *     (a stack fans out to member resources, which are watched individually),
 *     so they are excluded rather than permanently reported down.
 *   - a resource with a deployment still pending/building is mid-deploy; its
 *     old container is legitimately gone. Skipped until the deploy settles.
 *   - paused services (and members of a paused preview) are down on purpose.
 *
 * Started from apps/server alongside the host-health monitor; same lifecycle,
 * same best-effort contract (a watch that throws must never take the server
 * with it).
 */
import { canonicalId, hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { log } from "evlog";

import { createRedis } from "../lib/redis";
import { taskLabel } from "../lib/task-labels";
import { emitPlatformEvent } from "../notifications/emit";
import { isSwarmRuntime } from "../runtime";
import {
  type ActiveDown,
  activeDownSchema,
  type MissingResource,
  planDownTransitions,
} from "./down-transitions";

const DEFAULT_INTERVAL_MS = 60_000;
/** Missing for this long before it counts as down. Longer than any container
 *  restart and than the gap a redeploy leaves, short enough that an operator
 *  hears about a real outage while it is still the current event. */
const GRACE_MS = 5 * 60 * 1000;
/** A still-down service is re-announced this often: once a shift, not once a
 *  tick, matching the host-pressure reminder. */
const REMIND_AFTER_MS = 6 * 60 * 60 * 1000;
const ACTIVE_KEY = "otterdeploy:service-down:active";
const RESOURCE_ID_LABEL = "otterdeploy.resource.id";

let redis: RedisClient | null = null;
function redisClient(): RedisClient {
  redis ??= createRedis();
  return redis;
}

/** Process-local mirror of the persisted set: the fallback when Redis cannot
 *  be read, and written through on every save (as monitor.ts does). */
let activeFallback: ActiveDown = {};

async function loadActive(): Promise<ActiveDown> {
  const loaded = await Result.tryPromise({
    try: async () => {
      const raw = await redisClient().get(ACTIVE_KEY);
      return raw === null ? {} : activeDownSchema.parse(JSON.parse(raw));
    },
    catch: (cause) => cause,
  });
  if (loaded.isErr()) {
    log.warn({ downWatch: { step: "state-load" }, err: loaded.error });
    return activeFallback;
  }
  return loaded.value;
}

async function saveActive(next: ActiveDown): Promise<void> {
  activeFallback = next;
  const saved = await Result.tryPromise({
    try: () => redisClient().set(ACTIVE_KEY, JSON.stringify(next)),
    catch: (cause) => cause,
  });
  if (saved.isErr()) log.warn({ downWatch: { step: "state-save" }, err: saved.error });
}

/**
 * Every resource the database says should have a container right now: it owns
 * a deployment the builder marked `running`, it isn't paused, and it isn't a
 * compose stack (those have no container of their own).
 */
async function listExpected(): Promise<MissingResource[]> {
  const stack = alias(resource, "stack");
  const rows = await db
    .select({
      resourceId: resource.id,
      name: resource.name,
      type: resource.type,
      organizationId: project.organizationId,
      projectSlug: project.slug,
      projectName: project.name,
      stackName: stack.name,
      pausedReplicas: serviceResource.pausedReplicas,
      previewPaused: preview.paused,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    // Left joins: a database resource has no serviceResource row, a standalone
    // service has no stack, and most resources belong to no preview. None of
    // those may drop a resource from the watch.
    .leftJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .leftJoin(stack, eq(stack.id, serviceResource.stackId))
    .leftJoin(preview, eq(preview.id, resource.previewId))
    .where(and(eq(deployment.status, "running"), inArray(resource.type, ["service", "database"])));

  const expected = new Map<string, MissingResource>();
  for (const row of rows) {
    if (row.pausedReplicas !== null) continue; // scaled to zero on purpose
    if (row.previewPaused === true) continue; // preview parked, not broken
    // The auth table stores plain-text ids; brand via the runtime prefix check
    // rather than an assertion (same idiom as monitor.ts).
    if (!hasPrefix(row.organizationId, ID_PREFIX.organization)) continue;
    expected.set(row.resourceId, {
      resourceId: row.resourceId,
      // `postiz / postiz-db` for a stack member: "postiz-db is down" is not
      // enough to find it when a catalog template calls its container `server`.
      label: row.stackName ? `${row.stackName} / ${row.name}` : row.name,
      projectSlug: row.projectSlug,
      projectName: row.projectName,
      organizationId: row.organizationId,
      kind: row.type === "database" ? "database" : "service",
    });
  }
  return [...expected.values()];
}

/** Resources with a deploy in flight: their container is legitimately absent
 *  between the old one stopping and the new one converging. */
async function listMidDeploy(): Promise<Set<string>> {
  const rows = await db
    .select({ resourceId: deployment.resourceId })
    .from(deployment)
    .where(inArray(deployment.status, ["pending", "building"]));
  return new Set(rows.map((row) => row.resourceId));
}

/**
 * Resource ids with something actually up, or null when the runtime can't be
 * reached at all — which must NOT read as "everything is down".
 *
 * Swarm reads TASKS, not containers: a manager sees the whole cluster, while
 * `containers.list` only ever sees the node the control plane happens to run
 * on. Reporting every service on every other node as down would be the worst
 * possible false alarm.
 */
async function listRunningResourceIds(): Promise<Set<string> | null> {
  let docker: Docker;
  try {
    docker = Docker.fromEnv();
  } catch {
    return null;
  }
  try {
    const running = new Set<string>();
    if (isSwarmRuntime()) {
      const tasks = await docker.tasks.list({
        filters: { label: ["otterdeploy.managed=true"] },
      });
      if (tasks.isErr()) return null;
      for (const task of tasks.value) {
        // Desired state is what the orchestrator INTENDS. A task it is
        // replacing reads `shutdown` while its successor starts, and counting
        // only `running` states would call a rolling update an outage.
        if (task.DesiredState !== "running") continue;
        const labelled = taskLabel(task.Spec, RESOURCE_ID_LABEL);
        if (labelled) running.add(canonicalId(labelled));
      }
      return running;
    }
    const list = await docker.containers.list({
      all: false, // running (and restarting) only
      filters: { label: ["otterdeploy.managed=true"] },
    });
    if (list.isErr()) return null;
    for (const container of list.value) {
      const labelled = container.Labels[RESOURCE_ID_LABEL];
      // Containers created before the ID prefixes were shortened carry the old
      // spelling; canonicalise or they never match their resource and the whole
      // install reads as down.
      if (labelled) running.add(canonicalId(labelled));
    }
    return running;
  } finally {
    docker.destroy();
  }
}

function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function notifyDown(plan: ReturnType<typeof planDownTransitions>): Promise<void> {
  for (const { resource: down, downForMs, reminder } of plan.notify) {
    await emitPlatformEvent({
      organizationId: down.organizationId,
      eventId: "service.down",
      title: reminder ? "Service still down" : "Service is down",
      message: `${down.label} has had no running container for ${humanDuration(downForMs)}, but its latest deployment is still marked running.`,
      subject: {
        kind: "service",
        id: down.resourceId,
        label: down.label,
        project: down.projectSlug,
      },
      data: {
        resource: down.label,
        project: down.projectName,
        kind: down.kind,
        downFor: humanDuration(downForMs),
      },
    });
  }
}

export async function runDownWatchTick(now: number = Date.now()): Promise<void> {
  const running = await listRunningResourceIds();
  // Runtime unreachable: say nothing. A daemon we cannot ask is not evidence
  // that anything is down, and the alternative is one alert per service the
  // moment the socket hiccups.
  if (running === null) return;

  const [expected, midDeploy] = await Promise.all([listExpected(), listMidDeploy()]);
  const missing = expected.filter(
    (r) => !running.has(r.resourceId) && !midDeploy.has(r.resourceId),
  );

  const active = await loadActive();
  const plan = planDownTransitions({
    active,
    missing,
    now,
    graceMs: GRACE_MS,
    remindAfterMs: REMIND_AFTER_MS,
  });

  await notifyDown(plan);
  for (const back of plan.recovered) {
    const entry = expected.find((r) => r.resourceId === back.resourceId);
    // The resource may have been deleted rather than recovered, in which case
    // there is no org to notify and dropping the state is the whole job.
    if (!entry) continue;
    await emitPlatformEvent({
      organizationId: entry.organizationId,
      eventId: "service.up",
      title: "Service back up",
      message: `${back.label} is running again after ${humanDuration(back.downForMs)}.`,
      subject: {
        kind: "service",
        id: back.resourceId,
        label: back.label,
        project: entry.projectSlug,
      },
      data: { resource: back.label, project: entry.projectName },
    });
  }
  // Saved after the emits, like the pressure monitor: a crash in between
  // re-announces once (the inbox folds it), where the reverse order could
  // lose a recovery for good.
  await saveActive(plan.next);
}

async function tick(): Promise<void> {
  const ran = await Result.tryPromise({ try: () => runDownWatchTick(), catch: (cause) => cause });
  if (ran.isErr()) log.warn({ downWatch: { step: "tick" }, err: ran.error });
}

/**
 * Start the watch; returns a stop handle.
 *
 * The first pass waits 30s rather than firing immediately, so a restart does
 * not query docker while the daemon is still coming up. It deliberately does
 * NOT wait out the grace window: it does not need to. A resource absent right
 * after a restart is either new to the state (so `planDownTransitions` starts
 * its clock at `now` and stays silent until GRACE_MS has genuinely elapsed) or
 * carries its real `missingSince` from before the restart, in which case its
 * outage is old news and saying so is the point. The grace window is enforced
 * in the transition logic, where a restart cannot skip it.
 */
export function startServiceDownWatch(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  const kickoff = setTimeout(() => void tick(), 30_000);
  kickoff.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
