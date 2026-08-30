/**
 * ONE vocabulary for what a resource is doing, wherever it is shown.
 *
 * Before this there were six: the graph node's `ResourceStatus`, the stack
 * member's `StackServiceStatus`, the service panel's `ServicePanelState`, the
 * header pill's `PanelStatusTone`, the deployment status, and the timeline
 * tones. They disagreed by construction: the service header pill was computed
 * from the SCHEMA row (`valid` → "running") while the Overview tile next to it
 * read the runtime, so a crashed service said "running" and "error" on the same
 * screen. And none of them could say WHY.
 *
 * A {@link ResourceState} is three things: a `tone` (the five colours the
 * whole app uses), a `label` (one word: "crashed", "unhealthy", "queued"), and a
 * `why` (the phrase that explains it: "exited 1 · 3 restarts"). Every surface —
 * header pill, canvas card, member strip, switcher row, overview banner —
 * renders a ResourceState from here. The finer-grained derivation enums the
 * graph uses internally still exist; they feed THIS, they never reach a pixel
 * on their own.
 */

import type {
  ResourceStatus,
  StackServiceStatus,
} from "@/features/projects/components/graph/resource-node-types";

export type StatusTone = "running" | "building" | "error" | "paused" | "pending";

export interface ResourceState {
  tone: StatusTone;
  /** One word, lowercase. */
  label: string;
  /** The explanation, or null when the label says it all. */
  why: string | null;
}

/** Dot colour per tone. The same dot the graph, the strip and the rows use. */
export const TONE_DOT: Record<StatusTone, string> = {
  running: "bg-success",
  building: "bg-warning",
  error: "bg-destructive",
  paused: "bg-muted-foreground/60",
  pending: "bg-info",
};

export const TONE_TEXT: Record<StatusTone, string> = {
  running: "text-success",
  building: "text-warning",
  error: "text-destructive",
  paused: "text-muted-foreground",
  pending: "text-info",
};

/** Deployment lifecycle as the API reports it. */
export type DeploymentLifecycle =
  | "pending"
  | "building"
  | "starting"
  | "running"
  | "crashed"
  | "paused"
  | "failed"
  | "cancelled"
  | "superseded"
  | "removed";

/** The bits of a live task that explain a failure. Structural: the graph's
 *  `Task` and the collection's `ServiceTaskInfo` both satisfy it. */
export interface TaskFacts {
  exitCode?: number | null;
  error?: string | null;
  restarts?: number;
  desiredState?: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What the tasks say went wrong: the last non-zero exit code and the restart
 * count. Retired (restarted) swarm tasks are where the exit codes live, so they
 * are read, not filtered.
 */
export function taskWhy(tasks: readonly TaskFacts[]): string | null {
  const restarts = tasks.reduce((n, t) => n + (t.restarts ?? 0), 0);
  const exited = tasks.find((t) => typeof t.exitCode === "number" && t.exitCode !== 0);
  const parts: string[] = [];
  if (exited && typeof exited.exitCode === "number") parts.push(`exited ${exited.exitCode}`);
  else {
    const err = tasks.find((t) => t.error)?.error?.trim();
    if (err) parts.push(err);
  }
  if (restarts > 0) parts.push(plural(restarts, "restart"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The five-colour tone of the graph node's own status enum. */
export function toneOfNodeStatus(status: ResourceStatus): StatusTone {
  switch (status) {
    case "running":
      return "running";
    case "building":
    case "queued":
      return "building";
    case "error":
      return "error";
    case "paused":
      return "paused";
  }
}

const MEMBER_LABEL: Record<StackServiceStatus, string> = {
  running: "running",
  building: "building",
  deploying: "deploying",
  queued: "queued",
  error: "failed",
  // Deployed, no running task. That is down, and down is red: a grey
  // "offline" under a green stack header is how a stack that is half dead
  // read as fine.
  offline: "offline",
  pending: "pending",
};

export function toneOfMemberStatus(status: StackServiceStatus): StatusTone {
  switch (status) {
    case "running":
      return "running";
    case "building":
    case "deploying":
    case "queued":
      return "building";
    case "error":
    case "offline":
      return "error";
    case "pending":
      return "pending";
  }
}

/** A stack member's state. `error` on a from-source service is a build
 *  failure; on a pulled image it is a runtime one, and the words differ. */
export function memberState(
  status: StackServiceStatus | undefined,
  opts: { hasBuild?: boolean; tasks?: readonly TaskFacts[] } = {},
): ResourceState {
  const s = status ?? "offline";
  const why = opts.tasks ? taskWhy(opts.tasks) : null;
  if (s === "error" && opts.hasBuild && !why) {
    return { tone: "error", label: "build failed", why: null };
  }
  if (s === "error" && why) return { tone: "error", label: "crashed", why };
  return { tone: toneOfMemberStatus(s), label: MEMBER_LABEL[s], why };
}

/**
 * Roll a stack's members up WITHOUT hiding which ones are down.
 *
 * The label is always the count ("2/4 running"): it is the one number a dot
 * cannot carry. The tone is worst-wins (any member down → error, any in flight
 * → building). The why NAMES the members that are not running, so the header
 * reads "2/4 running · postiz-app crashed, temporal offline" instead of an
 * amber "2/4" that left the operator to open every member to find out which.
 */
export function stackState(
  members: readonly { name: string; state: ResourceState }[],
): ResourceState {
  const total = members.length;
  if (total === 0) return { tone: "pending", label: "no services", why: null };
  const up = members.filter((m) => m.state.tone === "running").length;
  const down = members.filter((m) => m.state.tone === "error");
  const inFlight = members.filter((m) => m.state.tone === "building");
  const label = `${up}/${total} running`;
  if (down.length > 0) {
    return {
      tone: "error",
      label,
      why: down.map((m) => `${m.name} ${m.state.label}`).join(", "),
    };
  }
  if (inFlight.length > 0) {
    return {
      tone: "building",
      label,
      why: inFlight.map((m) => `${m.name} ${m.state.label}`).join(", "),
    };
  }
  if (up === total) return { tone: "running", label, why: null };
  if (members.every((m) => m.state.tone === "pending")) {
    return { tone: "pending", label: "not deployed", why: null };
  }
  const paused = members.filter((m) => m.state.tone === "paused");
  return {
    tone: paused.length === total ? "paused" : "error",
    label,
    why: paused.length > 0 ? paused.map((m) => `${m.name} paused`).join(", ") : null,
  };
}

/** Runtime as the runtime driver reports it (`service.get`, database rows). */
export interface RuntimeFacts {
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health?: "healthy" | "unhealthy" | "starting" | null;
}

/**
 * A service's state, from the RUNTIME. Never from the schema row.
 *
 * Returns null while nothing is known yet (the live view has not loaded and
 * there is no deployment to read): the header then shows no pill, which is
 * more honest than a guessed one.
 */
export function serviceState(input: {
  pausedReplicas: number | null | undefined;
  runtime: RuntimeFacts | undefined;
  latestDeployment: { status: DeploymentLifecycle | null } | undefined;
  tasks: readonly TaskFacts[];
}): ResourceState | null {
  if (input.pausedReplicas != null) {
    return {
      tone: "paused",
      label: "paused",
      why: `resume restores ${plural(input.pausedReplicas, "replica")}`,
    };
  }
  const dep = input.latestDeployment?.status ?? null;
  const tasks = taskWhy(input.tasks);
  return deploymentOwnedState(dep, tasks) ?? runtimeState(input.runtime, dep, tasks);
}

/** A deploy in flight (or one that just failed) owns the state: the container
 *  may be missing or starting and that is expected, not a failure. Null when
 *  the deployment has settled and the runtime should answer. */
function deploymentOwnedState(
  dep: DeploymentLifecycle | null,
  tasks: string | null,
): ResourceState | null {
  switch (dep) {
    case "pending":
      return { tone: "building", label: "queued", why: "waiting for a builder" };
    case "building":
      return { tone: "building", label: "building", why: null };
    case "starting":
      return { tone: "building", label: "starting", why: null };
    case "failed":
      // No `why`. The deployment's `errorMessage` used to be piped in here,
      // but it is a server error sentence, not the short phrase this slot is
      // built for — things like `referenced resource "stack.db" not found in
      // this project`. In a one-line truncating span next to the name it just
      // read as noise clipped mid-word. The full message is already rendered,
      // untruncated and with a title, on the deployment card in the same
      // panel (see _shared/deployment-cards.tsx), which is where an operator
      // reading an error is looking anyway.
      return { tone: "error", label: "failed", why: null };
    case "crashed":
      return { tone: "error", label: "crashed", why: tasks ?? "container keeps exiting" };
    default:
      return null;
  }
}

function runtimeState(
  rt: RuntimeFacts | undefined,
  dep: DeploymentLifecycle | null,
  tasks: string | null,
): ResourceState | null {
  if (!rt) return dep === null ? { tone: "pending", label: "not deployed", why: null } : null;
  switch (rt.status) {
    case "running":
      if (rt.health === "unhealthy")
        return { tone: "error", label: "unhealthy", why: "healthcheck failing" };
      if (rt.health === "starting")
        return { tone: "building", label: "starting", why: "healthcheck pending" };
      return { tone: "running", label: "running", why: tasks };
    case "starting":
      return { tone: "building", label: "starting", why: null };
    case "stopped":
      return dep === "paused"
        ? { tone: "paused", label: "paused", why: null }
        : { tone: "error", label: "stopped", why: tasks ?? "container exited" };
    case "missing":
      return dep === null
        ? { tone: "pending", label: "not deployed", why: null }
        : { tone: "error", label: "not running", why: tasks ?? "no container" };
    case "error":
      return { tone: "error", label: "error", why: tasks };
  }
}

/** A database's state, from its container runtime. */
export function databaseState(input: {
  runtime: RuntimeFacts | undefined;
  latestDeploymentStatus?: DeploymentLifecycle | null;
}): ResourceState {
  const rt = input.runtime;
  // A staged create has no container yet; the draft the panel builds from the
  // manifest carries no runtime at all. This guard stays first: reading the
  // deploy flag before it once took the whole graph route to the error boundary.
  if (!rt) return { tone: "pending", label: "pending", why: null };
  const dep = input.latestDeploymentStatus;
  const deploying =
    rt.status !== "running" &&
    rt.status !== "starting" &&
    (dep === "building" || dep === "pending" || dep === "starting");
  if (deploying) return { tone: "building", label: "deploying", why: null };
  switch (rt.status) {
    case "running":
      return rt.health === "unhealthy"
        ? { tone: "error", label: "unhealthy", why: "healthcheck failing" }
        : { tone: "running", label: "running", why: null };
    case "starting":
      return { tone: "building", label: "starting", why: null };
    case "stopped":
      return { tone: "paused", label: "stopped", why: null };
    case "missing":
      return { tone: "error", label: "not running", why: "no container" };
    case "error":
      return { tone: "error", label: "error", why: null };
  }
}
