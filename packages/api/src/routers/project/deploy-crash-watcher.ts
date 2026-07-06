/**
 * Deploy crash watcher — turns container `die`/`oom` events into a visible
 * story instead of a silent status flip the user only notices by staring at
 * a badge.
 *
 * For every managed container that dies abnormally it:
 *   1. Appends a `system` line to the deployment's log ("exited (code 1) —
 *      restarting, attempt 2 of 5" / "gave up after 5 restart attempts"), so
 *      the deployment timeline SHOWS each retry and the moment the restart
 *      policy gave up — the exact trail an operator needs to answer "why".
 *   2. Publishes resource-changed so the UI re-derives status immediately
 *      (crashed badge without waiting for the 5s poll).
 *   3. Emits a `deploy.crashed` platform event (once per deployment) when the
 *      restart policy is exhausted, disabled, or the container has died 3+
 *      times — feeding the notification channels.
 *
 * Event-driven via the shared docker /events singleton (no extra daemon
 * connection); works for both runtimes. Plain docker restarts one container in
 * place (attempt counting via inspect RestartCount); swarm schedules fresh
 * tasks (each new container dies once), so attempts are counted per
 * deployment id instead.
 *
 * Best-effort by contract: every step swallows its own errors — a watcher
 * hiccup must never affect deploys. In-memory state only; a control-plane
 * restart at worst re-notifies one crash loop.
 */

import type { DeploymentId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentLog } from "@otterdeploy/db/schema/build";
import { deployment, project, resource } from "@otterdeploy/db/schema/project";
import { Docker } from "@otterdeploy/docker";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import type { ContainerEvent, DockerEvent } from "../../swarm";

import { emitPlatformEvent } from "../../notifications/emit";
import { subscribeDockerEvents } from "../../swarm";
import { publishResourceChanged } from "./project-event-bus";

/** Dies per deployment before we notify, absent a firmer signal (exhausted /
 *  disabled restart policy). Matches CRASH_LOOP_FAILURE_THRESHOLD in the
 *  status derivation so the notification and the badge agree. */
const NOTIFY_DIE_THRESHOLD = 3;

/** Exit codes that mean "stopped", not "crashed": 0 = clean exit, 143 =
 *  128+SIGTERM (docker stop — every redeploy stops the old container). */
const STOP_EXIT_CODES = new Set([0, 143]);

interface DieContext {
  deploymentId: string;
  resourceId: string;
  exitCode: number | null;
  /** Restarts performed so far (docker RestartCount at the moment of death). */
  attemptsSoFar: number;
  /** Restart cap; null = unlimited, 0 = restart disabled. */
  maxAttempts: number | null;
  swarmManaged: boolean;
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

function markNotified(deploymentId: string): boolean {
  if (notified.has(deploymentId)) return false;
  if (notified.size > BOOKKEEPING_CAP) notified.clear();
  notified.add(deploymentId);
  return true;
}

// ─── message composition ─────────────────────────────────────────────────

function exitPhrase(ctx: DieContext): string {
  if (ctx.oomKilled) return "container was killed — out of memory (OOM)";
  return ctx.exitCode != null
    ? `container exited (code ${ctx.exitCode})`
    : "container exited";
}

/** The retry-status suffix for the log line, and whether this die is the
 *  moment the restart policy gave up. */
function retryPhrase(ctx: DieContext): { line: string; gaveUp: boolean } {
  if (ctx.swarmManaged) {
    // Swarm restarts by scheduling a NEW task — per-container counters don't
    // apply; the derivation's failed-task threshold covers exhaustion.
    return { line: "swarm will reschedule a replacement task", gaveUp: false };
  }
  if (ctx.maxAttempts === 0) {
    return { line: 'restart policy is "none" — not restarting', gaveUp: true };
  }
  const attempt = ctx.attemptsSoFar + 1;
  if (ctx.maxAttempts == null) {
    return { line: `restarting (attempt ${attempt})`, gaveUp: false };
  }
  if (ctx.attemptsSoFar >= ctx.maxAttempts) {
    return {
      line: `gave up after ${ctx.attemptsSoFar} restart attempts (limit ${ctx.maxAttempts}) — service is down until redeployed`,
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

async function appendSystemLine(deploymentId: string, line: string): Promise<void> {
  await db
    .insert(deploymentLog)
    .values({ deploymentId: deploymentId as DeploymentId, stream: "system", line })
    .catch(() => undefined);
}

async function notifyCrashed(ctx: DieContext, detail: string): Promise<void> {
  if (!markNotified(ctx.deploymentId)) return;
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(deployment.id, ctx.deploymentId as DeploymentId));
  if (!info) return;
  await emitPlatformEvent({
    organizationId: info.organizationId as OrganizationId,
    eventId: "deploy.crashed",
    title: "Service crashed",
    message: `${info.resourceName}: ${detail}`,
    data: {
      deploymentId: ctx.deploymentId,
      resource: info.resourceName,
      project: info.projectName,
      exitCode: ctx.exitCode,
      restartAttempts: ctx.attemptsSoFar,
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
  const deploymentId = event.labels["otterdeploy.deployment.id"];
  const resourceId = event.labels["otterdeploy.resource.id"];
  if (!deploymentId || !resourceId) return;

  const rawExit = (event.raw.Actor?.Attributes as Record<string, string> | undefined)?.exitCode;
  const exitCode = rawExit != null && rawExit !== "" ? Number(rawExit) : null;

  const restartState = await inspectRestartState(event.containerId).catch(() => ({
    attemptsSoFar: 0,
    maxAttempts: null as number | null,
    oomKilled: false,
  }));

  // Clean stops (exit 0 / SIGTERM) are redeploys or operator stops — not
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
    oomKilled: restartState.oomKilled,
  };

  const retry = retryPhrase(ctx);
  const line = `${exitPhrase(ctx)} — ${retry.line}`;
  await appendSystemLine(deploymentId, line);
  void publishResourceChanged(resourceId as Parameters<typeof publishResourceChanged>[0]);

  const dies = bumpDieCount(deploymentId);
  if (retry.gaveUp || dies >= NOTIFY_DIE_THRESHOLD) {
    await notifyCrashed(ctx, line).catch(() => undefined);
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
