/**
 * Health-gated cutover for the plain-Docker runtime.
 *
 * Before this, `update` removed the running container and then started the new
 * one: a new version that crashed, listened on the wrong port or never became
 * healthy took the service down with it, and the deploy still read "running".
 * Now the old version keeps serving until the new one has passed the readiness
 * gate (readiness.ts), and a new version that never passes is removed again:
 * the deployment fails with the reason, the service keeps answering.
 *
 *   blue-green (the default): the new container starts beside the old one as
 *     `<name>--next`, on the project network WITHOUT the service's DNS aliases,
 *     so the edge cannot route to it yet. Ready → it takes the aliases, the old
 *     container is stopped (gracefully) and removed, and the new one is renamed
 *     to `<name>`. Not ready → it is removed; the old one never noticed.
 *   swap (a service that publishes a host port): two containers cannot bind the
 *     same host port, so the old one is stopped and parked as `<name>--prev`,
 *     the new one starts as `<name>`. Ready → the parked one is removed. Not
 *     ready → the new one is removed and the parked one renamed back and
 *     started: a short gap, then the previous version again.
 *   fresh (nothing running yet): start it, gate it, report the verdict. There
 *     is nothing to protect, so a failed first version is left in place for its
 *     logs (its restart policy is already capped).
 *
 * Docker is behind {@link RolloutHost} so the orchestration unit-tests against a
 * fake; docker-rollout-host.ts is the real one.
 */
import type { CreateContainerOptions } from "@otterdeploy/docker";

import type { Listener, PortProbe, ReadinessObservation, ReadinessPlan } from "./readiness";
import type { RuntimeStatus } from "./types";

import {
  assessReadiness,
  describeListeners,
  READINESS_START,
  READY_POLL_MS,
  READY_PROGRESS_EVERY_MS,
} from "./readiness";

/** Lines of the failed version's own output copied into the deployment log
 *  before it is removed, so the reason it failed outlives the container. */
const FAILED_LOG_TAIL_LINES = 40;

export interface ContainerObservation {
  id: string;
  state: string;
  exitCode: number | null;
  restartCount: number;
  oomKilled: boolean;
  health: "starting" | "healthy" | "unhealthy" | null;
  healthOutput: string | null;
}

export interface RolloutHost {
  /** The named container's state, null when there is none. */
  observe(name: string): Promise<ContainerObservation | null>;
  /** Can the edge open a TCP connection to `name:port`? */
  probePort(name: string, port: number): Promise<PortProbe>;
  /** The container's listening TCP sockets, null when they cannot be read. */
  listeners(name: string): Promise<Listener[] | null>;
  /** The last `lines` lines the container wrote (stdout + stderr). */
  logTail(name: string, lines: number): Promise<string[]>;
  /** Create (under `options.name`) and start, joining the extra networks. */
  createAndStart(options: CreateContainerOptions): Promise<void>;
  /** Stop gracefully and remove; a no-op when the container is absent. */
  remove(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  start(name: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Re-attach `name` to `network` under exactly these DNS aliases. */
  setAliases(name: string, network: string, aliases: string[]): Promise<void>;
  /** One line to the deployment's Deploy Logs. */
  log(line: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RolloutInput {
  /** `docker create` payload for the new version, named `serviceName`, with
   *  the service's aliases on `networkName`. */
  options: CreateContainerOptions;
  serviceName: string;
  networkName: string;
  aliases: string[];
  plan: ReadinessPlan;
  /** The service publishes a port on the host: blue-green is impossible. */
  publishesHostPort: boolean;
}

/** The new version's name while it is being gated beside the old one. */
export function candidateName(serviceName: string): string {
  return `${serviceName}--next`;
}

/** Where a swap rollout parks the previous version while the new one is gated. */
export function parkedName(serviceName: string): string {
  return `${serviceName}--prev`;
}

type Gate = { ok: true } | { ok: false; reason: string };

interface Round {
  seen: ContainerObservation | null;
  state: string;
  port: PortProbe | null;
}

/** One look at the container: its state and, when it runs, the port probe. */
async function observeRound(host: RolloutHost, name: string, plan: ReadinessPlan): Promise<Round> {
  const seen = await host.observe(name);
  const state = seen?.state ?? "missing";
  if (plan.port === null) return { seen, state, port: null };
  const port = state === "running" ? await host.probePort(name, plan.port) : "closed";
  return { seen, state, port };
}

function observation(round: Round, elapsedMs: number): ReadinessObservation {
  return {
    elapsedMs,
    state: round.state,
    exitCode: round.seen?.exitCode ?? null,
    restartCount: round.seen?.restartCount ?? 0,
    oomKilled: round.seen?.oomKilled ?? false,
    health: round.seen?.health ?? null,
    healthOutput: round.seen?.healthOutput ?? null,
    port: round.port,
  };
}

function progressLine(round: Round, plan: ReadinessPlan): string {
  const health = round.seen?.health ? `, health ${round.seen.health}` : "";
  const reach = round.port ? `, port ${plan.port} ${round.port}` : "";
  return `still waiting: ${round.state}${health}${reach}`;
}

/** The gate's reason, plus what the app listens on when the port stayed shut. */
async function failureReason(
  host: RolloutHost,
  name: string,
  plan: ReadinessPlan,
  round: Round,
  reason: string,
): Promise<string> {
  if (plan.port === null || round.port !== "closed" || round.state !== "running") return reason;
  const why = describeListeners(await host.listeners(name), plan.port);
  return why ? `${reason}; ${why}` : reason;
}

/** Poll `name` through the readiness gate until it is ready or has failed. */
async function awaitReadiness(
  host: RolloutHost,
  name: string,
  plan: ReadinessPlan,
): Promise<Gate> {
  const started = host.now();
  let track = READINESS_START;
  let progressAt = started;
  const target = plan.port === null ? "to stay up" : `on port ${plan.port}`;
  host.log(`waiting for the new version ${target} (up to ${Math.round(plan.timeoutMs / 1000)}s)`);
  for (;;) {
    const round = await observeRound(host, name, plan);
    const verdict = assessReadiness(plan, observation(round, host.now() - started), track);
    if (verdict.kind === "ready") return { ok: true };
    if (verdict.kind === "failed") {
      return { ok: false, reason: await failureReason(host, name, plan, round, verdict.reason) };
    }
    track = verdict.track;
    if (host.now() - progressAt >= READY_PROGRESS_EVERY_MS) {
      progressAt = host.now();
      host.log(progressLine(round, plan));
    }
    await host.sleep(READY_POLL_MS);
  }
}

async function copyLogTail(host: RolloutHost, name: string): Promise<void> {
  const lines = await host.logTail(name, FAILED_LOG_TAIL_LINES);
  if (lines.length === 0) return;
  host.log(`── last ${lines.length} lines from the failed version ──`);
  for (const line of lines) host.log(line);
}

async function settledStatus(
  host: RolloutHost,
  serviceName: string,
  networkName: string,
): Promise<RuntimeStatus> {
  const seen = await host.observe(serviceName);
  return {
    serviceId: seen?.id ?? null,
    serviceName,
    networkName,
    status: seen?.state === "running" ? "running" : "error",
    health: seen?.health ?? null,
  };
}

function failedStatus(
  input: RolloutInput,
  serviceId: string | null,
  reason: string,
  rolledBack: boolean,
): RuntimeStatus {
  return {
    serviceId,
    serviceName: input.serviceName,
    networkName: input.networkName,
    status: "error",
    health: null,
    errorMessage: rolledBack
      ? `new version ${reason}; the previous version keeps serving`
      : `new version ${reason}`,
    rolledBack,
  };
}

async function rollOutFresh(host: RolloutHost, input: RolloutInput): Promise<RuntimeStatus> {
  await host.remove(input.serviceName);
  await host.createAndStart(input.options);
  const gate = await awaitReadiness(host, input.serviceName, input.plan);
  if (gate.ok) return settledStatus(host, input.serviceName, input.networkName);
  await copyLogTail(host, input.serviceName);
  const seen = await host.observe(input.serviceName);
  return failedStatus(input, seen?.id ?? null, gate.reason, false);
}

async function rollOutBlueGreen(
  host: RolloutHost,
  input: RolloutInput,
  current: ContainerObservation,
): Promise<RuntimeStatus> {
  const next = candidateName(input.serviceName);
  // A candidate left behind by a deploy that died mid-gate.
  await host.remove(next);
  await host.createAndStart({
    ...input.options,
    name: next,
    NetworkingConfig: { EndpointsConfig: { [input.networkName]: { Aliases: [] } } },
  });
  const gate = await awaitReadiness(host, next, input.plan);
  if (!gate.ok) {
    await copyLogTail(host, next);
    await host.remove(next);
    host.log(`kept the previous version: the new one ${gate.reason}`);
    return failedStatus(input, current.id, gate.reason, true);
  }
  host.log("new version ready: moving traffic to it");
  await host.setAliases(next, input.networkName, input.aliases);
  await host.remove(input.serviceName);
  await host.rename(next, input.serviceName);
  return settledStatus(host, input.serviceName, input.networkName);
}

async function rollOutSwap(host: RolloutHost, input: RolloutInput): Promise<RuntimeStatus> {
  const parked = parkedName(input.serviceName);
  await host.remove(parked);
  host.log("the service publishes a host port: stopping the previous version to start the new one");
  await host.stop(input.serviceName);
  await host.rename(input.serviceName, parked);
  await host.createAndStart(input.options);
  const gate = await awaitReadiness(host, input.serviceName, input.plan);
  if (gate.ok) {
    await host.remove(parked);
    return settledStatus(host, input.serviceName, input.networkName);
  }
  await copyLogTail(host, input.serviceName);
  await host.remove(input.serviceName);
  await host.rename(parked, input.serviceName);
  await host.start(input.serviceName);
  host.log(`restored the previous version: the new one ${gate.reason}`);
  const restored = await host.observe(input.serviceName);
  return failedStatus(input, restored?.id ?? null, gate.reason, true);
}

/** Roll `input.options` out as `input.serviceName`, gated (see module doc). */
export async function rollOutContainer(
  host: RolloutHost,
  input: RolloutInput,
): Promise<RuntimeStatus> {
  const current = await host.observe(input.serviceName);
  if (!current || current.state !== "running") return rollOutFresh(host, input);
  if (input.publishesHostPort) return rollOutSwap(host, input);
  return rollOutBlueGreen(host, input, current);
}
