/**
 * Poll-based "wait for deploy" used by `deploy`/`sync`/`up`/`build --wait`.
 *
 * Two convergence signals, because a service reaches "up" two different ways:
 *   - GIT builds / redeploys / rollbacks insert a `deployment` row that walks
 *     pending → building → running|failed. The list READ reconciles stale rows.
 *   - IMAGE services provisioned by a manifest apply get NO deployment row —
 *     the reconciler creates the container directly. Their signal is the
 *     resource's runtime tasks (collapsed state: running | building | error).
 *
 * We follow the newest deployment row when there is one, and fall back to the
 * task rollup when there isn't. success = running; failure = a failed/crashed
 * deployment or an errored task with nothing running.
 */

import { consola } from "consola";

import type { CliClient } from "./resolve";

export interface WaitTarget {
  resourceId: string;
  name: string;
}

export interface WaitOutcome {
  name: string;
  status: string;
  deploymentId: string | null;
  errorMessage: string | null;
}

const POLL_INTERVAL_MS = 2_500;
// Nothing scheduled at all (no deployment row AND no task) for this long means
// the container never came up — an image pull failure or a scheduling error
// that produces no failed task to observe.
const NOTHING_SCHEDULED_GRACE_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const BUILD_LOG_TAIL_LINES = 40;
// The build-log stream self-terminates only when the deployment's STORED status
// is terminal. A build whose worker died can be DERIVED "failed" while stored
// "building", in which case the server enters an infinite live-tail — so cap
// the scrollback drain rather than consuming it unconditionally.
const BUILD_LOG_DRAIN_MS = 4_000;
const DRAIN_TICK_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PendingTarget {
  target: WaitTarget;
  lastPhase: string | null;
}

type Phase =
  | { kind: "success"; label: string; deploymentId: string | null }
  | { kind: "failure"; label: string; deploymentId: string | null; errorMessage: string | null }
  | { kind: "progress"; label: string };

type DeploymentRow = Awaited<
  ReturnType<CliClient["project"]["resource"]["deployments"]["list"]>
>[number];
type TaskRow = Awaited<ReturnType<CliClient["project"]["resource"]["tasks"]>>[number];

// GIT builds / redeploys walk the deployment row through its lifecycle; the
// row status is authoritative while one exists.
export function evaluateDeployment(newest: DeploymentRow): Phase {
  if (newest.status === "failed" || newest.status === "crashed") {
    return {
      kind: "failure",
      label: newest.status,
      deploymentId: newest.id,
      errorMessage: newest.errorMessage,
    };
  }
  if (newest.status === "running") {
    return { kind: "success", label: "running", deploymentId: newest.id };
  }
  // pending / building / starting — and superseded / removed, where a newer
  // roll should soon own the wait: keep polling.
  return { kind: "progress", label: newest.status };
}

// IMAGE services get no deployment row — the container is created directly, so
// the runtime task rollup (running | building | error) is the only signal.
export function evaluateTasks(tasks: TaskRow[], elapsedMs: number): Phase {
  if (tasks.some((t) => t.state === "running")) {
    return { kind: "success", label: "running", deploymentId: null };
  }
  const errored = tasks.find((t) => t.state === "error");
  if (errored) {
    return {
      kind: "failure",
      label: "error",
      deploymentId: null,
      errorMessage: errored.error ?? errored.message ?? "container failed",
    };
  }
  if (tasks.length === 0 && elapsedMs >= NOTHING_SCHEDULED_GRACE_MS) {
    return {
      kind: "failure",
      label: "not-scheduled",
      deploymentId: null,
      errorMessage: "no container was scheduled",
    };
  }
  return { kind: "progress", label: tasks.length > 0 ? "starting" : "scheduling" };
}

// Deployment status wins when a row exists; otherwise the task rollup does.
function evaluate(newest: DeploymentRow | undefined, tasks: TaskRow[], elapsedMs: number): Phase {
  return newest ? evaluateDeployment(newest) : evaluateTasks(tasks, elapsedMs);
}

// Drain the build-log stream's scrollback and print the tail. The stream may
// NOT self-terminate (see BUILD_LOG_DRAIN_MS), so each next() is raced against
// a ticker and the whole drain is bounded by a deadline — never a bare
// `for await`, which would hang on a still-"building" stored status.
async function printBuildLogTail(client: CliClient, deploymentId: string): Promise<void> {
  const lines: string[] = [];
  const stream = await client.project.resource.deployments.buildLogs.stream({ deploymentId });
  const iterator = stream[Symbol.asyncIterator]();
  const deadline = Date.now() + BUILD_LOG_DRAIN_MS;
  let pending: Promise<IteratorResult<{ stream: string; line: string }>> | null = null;
  try {
    while (Date.now() < deadline) {
      pending ??= iterator.next();
      const winner = await Promise.race([
        pending.then((result) => ({ tick: false as const, result })),
        new Promise<{ tick: true }>((resolve) => {
          setTimeout(() => resolve({ tick: true }), DRAIN_TICK_MS);
        }),
      ]);
      if (winner.tick) continue;
      pending = null;
      if (winner.result.done) break;
      const event = winner.result.value;
      const tag = event.stream === "stderr" ? "[err] " : event.stream === "system" ? "[sys] " : "";
      lines.push(`${tag}${event.line}`);
      if (lines.length > BUILD_LOG_TAIL_LINES) lines.shift();
    }
  } finally {
    pending?.catch(() => undefined);
    void iterator.return?.()?.catch(() => undefined);
  }
  if (lines.length === 0) return;
  consola.log(`  ── build log (last ${lines.length} line(s)) ──`);
  for (const line of lines) consola.log(`  ${line}`);
}

export async function waitForDeployments(opts: {
  client: CliClient;
  projectId: string;
  targets: WaitTarget[];
  timeoutMs?: number;
  json?: boolean;
}): Promise<{ ok: boolean; outcomes: WaitOutcome[] }> {
  const { client, projectId, json = false } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const outcomes: WaitOutcome[] = [];
  let pending: PendingTarget[] = opts.targets.map((target) => ({ target, lastPhase: null }));
  let anyFailed = false;

  if (!json && pending.length > 0) {
    consola.info(`Waiting for ${pending.length} service(s) to reach running…`);
  }

  while (pending.length > 0 && Date.now() - startedAt < timeoutMs) {
    const settled = new Set<PendingTarget>();
    const failures: Array<{
      name: string;
      deploymentId: string | null;
      label: string;
      errorMessage: string | null;
    }> = [];

    await Promise.all(
      pending.map(async (state) => {
        const [rows, tasks] = await Promise.all([
          client.project.resource.deployments.list({
            projectId,
            resourceId: state.target.resourceId,
          }),
          client.project.resource.tasks({ projectId, resourceId: state.target.resourceId }),
        ]);
        const phase = evaluate(rows[0], tasks, Date.now() - startedAt);

        if (phase.kind === "success") {
          if (!json) consola.log(`${state.target.name}: running ✓`);
          outcomes.push({
            name: state.target.name,
            status: "running",
            deploymentId: phase.deploymentId,
            errorMessage: null,
          });
          settled.add(state);
          return;
        }
        if (phase.kind === "failure") {
          anyFailed = true;
          outcomes.push({
            name: state.target.name,
            status: phase.label,
            deploymentId: phase.deploymentId,
            errorMessage: phase.errorMessage,
          });
          failures.push({
            name: state.target.name,
            deploymentId: phase.deploymentId,
            label: phase.label,
            errorMessage: phase.errorMessage,
          });
          settled.add(state);
          return;
        }
        // progress — log only on transition
        if (!json && phase.label !== state.lastPhase) {
          consola.log(`${state.target.name}: ${phase.label}…`);
        }
        state.lastPhase = phase.label;
      }),
    );

    // Print failures sequentially so build-log tails don't interleave.
    if (!json) {
      for (const failure of failures) {
        consola.error(
          `${failure.name}: ${failure.label} ✗${failure.errorMessage ? ` — ${failure.errorMessage}` : ""}`,
        );
        if (failure.deploymentId) await printBuildLogTail(client, failure.deploymentId);
        else consola.log(`  Run \`otterdeploy logs ${failure.name}\` for container output.`);
      }
    }

    pending = pending.filter((state) => !settled.has(state));
    if (pending.length > 0) await sleep(POLL_INTERVAL_MS);
  }

  for (const state of pending) {
    anyFailed = true;
    if (!json) consola.error(`${state.target.name}: timed out waiting to reach running.`);
    outcomes.push({
      name: state.target.name,
      status: "timeout",
      deploymentId: null,
      errorMessage: null,
    });
  }

  return { ok: !anyFailed, outcomes };
}
