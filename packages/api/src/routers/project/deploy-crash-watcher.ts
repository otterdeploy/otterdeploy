/**
 * Deploy crash watcher. Turns container `die`/`oom` events into a visible
 * story instead of a silent status flip the user only notices by staring at
 * a badge.
 *
 * For every managed container that dies abnormally it:
 *   1. Appends a `system` line to the deployment's log ("exited (code 1),
 *      restarting, attempt 2 of 5" / "gave up after 5 restart attempts"), so
 *      the deployment timeline SHOWS each retry and the moment the restart
 *      policy gave up. The exact trail an operator needs to answer "why".
 *   2. Publishes resource-changed so the UI re-derives status immediately
 *      (crashed badge without waiting for the 5s poll).
 *   3. Emits a `deploy.crashed` platform event (once per deployment) when the
 *      restart policy is exhausted, disabled, or the container has died 3+
 *      times, feeding the notification channels.
 *
 * Event-driven via the shared docker /events singleton (no extra daemon
 * connection); works for both runtimes. Plain docker restarts one container in
 * place (attempt counting via inspect RestartCount); swarm schedules fresh
 * tasks (each new container dies once), so attempts are counted per
 * deployment id instead.
 *
 * Best-effort by contract: every step swallows its own errors. A watcher
 * hiccup must never affect deploys. In-memory state only; a control-plane
 * restart at worst re-notifies one crash loop.
 */

import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema/build";
import { deployment, project, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { idSchema } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { log } from "evlog";

import type { ContainerEvent, DockerEvent } from "../../swarm";

import { emitPlatformEvent } from "../../notifications/emit";
import { subscribeDockerEvents } from "../../swarm";
import { scaleSwarmServiceToZero } from "../../swarm/service";
import { publishResourceChanged } from "./project-event-bus";

/** Dies per deployment before we notify, absent a firmer signal (exhausted /
 *  disabled restart policy). Matches CRASH_LOOP_FAILURE_THRESHOLD in the
 *  status derivation so the notification and the badge agree. */
const NOTIFY_DIE_THRESHOLD = 3;

/** Exit codes that mean "stopped", not "crashed": 0 = clean exit, 143 =
 *  128+SIGTERM (docker stop, every redeploy stops the old container). */
const STOP_EXIT_CODES = new Set([0, 143]);

interface DieContext {
  deploymentId: DeploymentId;
  resourceId: ResourceId;
  exitCode: number | null;
  /** Restarts performed so far (docker RestartCount at the moment of death). */
  attemptsSoFar: number;
  /** Restart cap; null = unlimited, 0 = restart disabled. */
  maxAttempts: number | null;
  swarmManaged: boolean;
  /** `com.docker.swarm.service.name`, when this die came from a swarm task.
   *  The identity that SURVIVES task replacement — the container id does not. */
  swarmServiceName: string | null;
  oomKilled: boolean;
}

// ─── per-deployment bookkeeping (in-memory, bounded) ─────────────────────

const dieCounts = new Map<string, number>();
const notified = new Set<string>();
const BOOKKEEPING_CAP = 1000;

function bumpDieCount(deploymentId: string): number {
  if (dieCounts.size > BOOKKEEPING_CAP) dieCounts.clear();
  const next = (dieCounts.get(deploymentId) ?? 0) + 1;
  dieCounts.set(deploymentId, next);
  return next;
}

/**
 * Docker cannot cap `always`/`unless-stopped` restarts (MaximumRetryCount is
 * on-failure only), so a compose service with `restart: always` and a boot
 * crash looped FOREVER: 123k deploy-log lines from one bad env var in
 * production. Track RAPID consecutive dies per container (a healthy
 * long-runner that crashes occasionally must keep its keep-alive) and stop
 * the container once the loop is undeniable. The driver maps condition "any"
 * to unless-stopped, so an explicit stop ends the loop for good; a redeploy
 * starts fresh.
 *
 * Keyed by whatever identity SURVIVES a restart, which differs per runtime:
 * plain docker restarts the same container (id stable, so key on it), swarm
 * schedules a replacement task with a NEW id (so key on the service name).
 * Keying swarm on the container is why the cap never bit there — the counter
 * re-read 1 on every death. See holdDownCrashLoop.
 */
const RAPID_DIE_WINDOW_MS = 60_000;
const RAPID_DIE_CAP = 5;
const rapidDies = new Map<string, { count: number; lastAt: number }>();

function bumpRapidDies(containerId: string): number {
  if (rapidDies.size > BOOKKEEPING_CAP) rapidDies.clear();
  const now = Date.now();
  const prev = rapidDies.get(containerId);
  const count = prev && now - prev.lastAt < RAPID_DIE_WINDOW_MS ? prev.count + 1 : 1;
  rapidDies.set(containerId, { count, lastAt: now });
  return count;
}

/** Explicit stop breaks the restart loop; the resulting die reports 143 and
 *  is filtered as a clean stop, so this cannot recurse. */
async function stopCrashLoop(containerId: string): Promise<boolean> {
  const docker = Docker.fromEnv();
  try {
    const stopped = await docker.containers.getContainer(containerId).stop({ t: 5 });
    return stopped.isOk();
  } finally {
    docker.destroy();
  }
}

/**
 * Both enforcement paths, which differ only in three values.
 *
 * The shape is identical: count rapid dies against a key, take the action that
 * actually stops this runtime, then report it once. Only the KEY, the ACTION
 * and the sentence differ, so they are arguments rather than a second copy of
 * the body.
 *
 * The key is the interesting one. It has to be whatever identity SURVIVES a
 * restart, and that is runtime-specific:
 *
 *   - plain docker restarts the SAME container, so the container id is stable
 *     and counting on it works.
 *   - swarm schedules a REPLACEMENT TASK with a new container id, so counting
 *     on the container re-reads 1 on every death and can never reach the cap.
 *     That is why previous attempts at this never bit. Count on the service
 *     name instead.
 */
async function holdDownCrashLoop(
  ctx: DieContext,
  plan: { key: string; stop: () => Promise<boolean>; outcome: string },
): Promise<boolean> {
  if (bumpRapidDies(plan.key) < RAPID_DIE_CAP) return false;
  if (!(await plan.stop().catch(() => false))) return false;

  const line = `${exitPhrase(ctx)}: crash loop, ${plan.outcome}`;
  await appendSystemLine(ctx.deploymentId, line);
  void publishResourceChanged(ctx.resourceId);
  await notifyCrashed(ctx, line, "gave-up").catch(() => undefined);
  return true;
}

/**
 * Stop a crash loop the runtime will not stop itself. True when the die was
 * fully handled (service held down, line + alert emitted).
 *
 * SWARM: `RestartPolicy.MaxAttempts` (swarm/internals.ts) is per-TASK and it
 * works — five attempts, then that task is done. But the orchestrator then
 * schedules a fresh task to satisfy the replica count, with a fresh counter,
 * forever: a working cap that stops nothing. One stack booted ~1,150 times
 * behind it and wrote 51k log lines. Swarm has no service-level give-up, so
 * the only lever is the desired state it converges on — scale to 0. Scaling
 * rather than removing leaves the spec, volumes and routes for a redeploy.
 *
 * PLAIN DOCKER: `always`/`unless-stopped` cannot be capped at all
 * (MaximumRetryCount is on-failure only), so an explicit stop is the lever.
 * A capped policy needs nothing from us; docker gives up on its own.
 */
async function breakCrashLoop(ctx: DieContext, containerId: string): Promise<boolean> {
  const swarmService = ctx.swarmManaged ? ctx.swarmServiceName : null;
  if (swarmService) {
    return holdDownCrashLoop(ctx, {
      key: `svc:${swarmService}`,
      stop: () => scaleSwarmServiceToZero({ serviceName: swarmService }),
      outcome: `scaled to 0 replicas after ${RAPID_DIE_CAP} rapid task failures. Swarm reschedules past its own restart cap, so the service is held down until redeployed`,
    });
  }
  if (ctx.swarmManaged || ctx.maxAttempts != null) return false;
  return holdDownCrashLoop(ctx, {
    key: containerId,
    stop: () => stopCrashLoop(containerId),
    outcome: `stopped after ${RAPID_DIE_CAP} rapid restarts (the restart policy has no cap). Service is down until redeployed`,
  });
}

/** Dedupe key includes the phase so a deployment gets at most TWO alerts: one
 *  when the crash loop is first detected, one when the policy gives up for
 *  good: the actionable moment, which must not be swallowed by the first. */
function markNotified(deploymentId: string, phase: "looping" | "gave-up"): boolean {
  const key = `${deploymentId}:${phase}`;
  if (notified.has(key)) return false;
  if (notified.size > BOOKKEEPING_CAP) notified.clear();
  notified.add(key);
  return true;
}

// ─── message composition ─────────────────────────────────────────────────

function exitPhrase(ctx: DieContext): string {
  if (ctx.oomKilled) return "container was killed, out of memory (OOM)";
  return ctx.exitCode != null ? `container exited (code ${ctx.exitCode})` : "container exited";
}

/** The retry-status suffix for the log line, and whether this die is the
 *  moment the restart policy gave up. */
function retryPhrase(ctx: DieContext): { line: string; gaveUp: boolean } {
  if (ctx.swarmManaged) {
    // Swarm restarts by scheduling a NEW task, so per-container counters do
    // not apply. Note this is NOT the give-up moment: swarm has no
    // service-level exhaustion, it reschedules indefinitely.
    // breakSwarmRescheduleLoop is what ends it.
    return { line: "swarm will reschedule a replacement task", gaveUp: false };
  }
  if (ctx.maxAttempts === 0) {
    return { line: 'restart policy is "none", not restarting', gaveUp: true };
  }
  const attempt = ctx.attemptsSoFar + 1;
  if (ctx.maxAttempts == null) {
    return { line: `restarting (attempt ${attempt})`, gaveUp: false };
  }
  if (ctx.attemptsSoFar >= ctx.maxAttempts) {
    return {
      line: `gave up after ${ctx.attemptsSoFar} restart attempts (limit ${ctx.maxAttempts}). Service is down until redeployed`,
      gaveUp: true,
    };
  }
  return { line: `restarting (attempt ${attempt} of ${ctx.maxAttempts})`, gaveUp: false };
}

// ─── docker plumbing ─────────────────────────────────────────────────────

/** RestartCount + policy from inspect. The dead container still exists at
 *  `die` time (restarting or exited), so inspect is reliable here. */
async function inspectRestartState(
  containerId: string,
): Promise<{ attemptsSoFar: number; maxAttempts: number | null; oomKilled: boolean }> {
  const docker = Docker.fromEnv();
  try {
    const inspected = await docker.containers.getContainer(containerId).inspect();
    if (inspected.isErr()) return { attemptsSoFar: 0, maxAttempts: null, oomKilled: false };
    const value = inspected.value;
    const policy = value.HostConfig?.RestartPolicy;
    const name = policy?.Name ?? "";
    const maxAttempts =
      name === "no" || name === ""
        ? 0
        : name === "on-failure"
          ? (policy?.MaximumRetryCount ?? 0) || null
          : null; // always / unless-stopped → unlimited
    return {
      attemptsSoFar: value.RestartCount ?? 0,
      maxAttempts,
      oomKilled: value.State?.OOMKilled ?? false,
    };
  } finally {
    docker.destroy();
  }
}

async function appendSystemLine(deploymentId: DeploymentId, line: string): Promise<void> {
  await db
    .insert(deploymentLog)
    // Runtime restart/health events are deploy-phase. They belong in Deploy
    // Logs, not Build Logs.
    .values({ deploymentId, stream: "system", phase: "deploy", line })
    .catch(() => undefined);
}

async function notifyCrashed(
  ctx: DieContext,
  detail: string,
  phase: "looping" | "gave-up",
): Promise<void> {
  if (!markNotified(ctx.deploymentId, phase)) return;
  // The owning stack, when this resource is a compose member. Without it the
  // alert reads `server: container exited`, and "server" is what Authentik,
  // Supabase and half the catalog call their main container, so the one thing
  // the operator needs (WHICH stack) is the one thing missing.
  const stack = alias(resource, "stack");
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
      stackName: stack.name,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    // Left joins: a standalone service has no serviceResource stackId, and a
    // database has no serviceResource row at all. Neither may drop the alert.
    .leftJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
    .leftJoin(stack, eq(stack.id, serviceResource.stackId))
    .where(eq(deployment.id, ctx.deploymentId));
  if (!info) return;
  // The column is a plain-text FK; brand it via the schema rather than a cast.
  const organizationId = idSchema.organization.safeParse(info.organizationId);
  if (!organizationId.success) return;
  // `authentik / server` for a stack member, plain `web` for a standalone one.
  const label = info.stackName ? `${info.stackName} / ${info.resourceName}` : info.resourceName;
  await emitPlatformEvent({
    organizationId: organizationId.data,
    eventId: "deploy.crashed",
    title: "Service crashed",
    message: `${label}: ${detail}`,
    data: {
      deploymentId: ctx.deploymentId,
      resource: label,
      project: info.projectName,
      ...(info.stackName ? { stack: info.stackName } : {}),
      exitCode: ctx.exitCode == null ? "unknown" : String(ctx.exitCode),
      restartAttempts: String(ctx.attemptsSoFar),
    },
  });
}

// ─── the watcher ─────────────────────────────────────────────────────────

function isManagedDie(event: DockerEvent): event is ContainerEvent {
  return (
    event.kind === "container" &&
    event.action === "die" &&
    event.labels["otterdeploy.managed"] === "true"
  );
}

async function handleDie(event: ContainerEvent): Promise<void> {
  // Labels are stamped at container creation and never rewritten, so a
  // container predating the ID-prefix shortening still reports the old
  // spelling; the idSchema parse canonicalises (and brands) both before
  // either is used to look anything up.
  const parsedDeploymentId = idSchema.deployment.safeParse(
    event.labels["otterdeploy.deployment.id"],
  );
  const parsedResourceId = idSchema.resource.safeParse(event.labels["otterdeploy.resource.id"]);
  if (!parsedDeploymentId.success || !parsedResourceId.success) return;
  const deploymentId = parsedDeploymentId.data;
  const resourceId = parsedResourceId.data;

  const rawExit = event.raw.Actor?.Attributes?.exitCode;
  const exitCode = rawExit != null && rawExit !== "" ? Number(rawExit) : null;

  const restartState = await inspectRestartState(event.containerId).catch(
    (): Awaited<ReturnType<typeof inspectRestartState>> => ({
      attemptsSoFar: 0,
      maxAttempts: null,
      oomKilled: false,
    }),
  );

  // Clean stops (exit 0 / SIGTERM) are redeploys or operator stops, not
  // crashes. OOM kills report 137 and would look like a plain kill without
  // the inspect flag, so check it before discarding.
  if (exitCode != null && STOP_EXIT_CODES.has(exitCode) && !restartState.oomKilled) return;

  const ctx: DieContext = {
    deploymentId,
    resourceId,
    exitCode,
    attemptsSoFar: restartState.attemptsSoFar,
    maxAttempts: restartState.maxAttempts,
    swarmManaged: event.labels["com.docker.swarm.service.id"] != null,
    swarmServiceName: event.labels["com.docker.swarm.service.name"] ?? null,
    oomKilled: restartState.oomKilled,
  };

  // A tight loop the runtime will not stop on its own: enforce it here.
  if (await breakCrashLoop(ctx, event.containerId)) return;

  const retry = retryPhrase(ctx);
  const line = `${exitPhrase(ctx)}: ${retry.line}`;
  await appendSystemLine(deploymentId, line);
  void publishResourceChanged(resourceId);

  const dies = bumpDieCount(deploymentId);
  if (retry.gaveUp || dies >= NOTIFY_DIE_THRESHOLD) {
    await notifyCrashed(ctx, line, retry.gaveUp ? "gave-up" : "looping").catch(() => undefined);
  }
}

/** Start watching for managed-container crashes. Returns a stop handle. */
export function startDeployCrashWatcher(): () => void {
  const sub = subscribeDockerEvents((event) => {
    if (!isManagedDie(event)) return;
    void handleDie(event).catch((cause) => {
      log.warn({
        crashWatcher: { event: "handle-die-failed", containerId: event.containerId },
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  });
  return () => sub.close();
}
