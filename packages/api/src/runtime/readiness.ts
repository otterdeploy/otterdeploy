/**
 * The readiness gate a new version must pass before it takes traffic.
 *
 * Pure: every decision here is a function of what the driver observed, so the
 * cutover rule unit-tests without a daemon. The drivers own the polling and the
 * Docker calls (docker-rollout.ts for plain Docker, swarm/service.ts for Swarm).
 *
 * "Ready" means all of:
 *   - the container is running and has not restarted while being watched;
 *   - a declared healthcheck reports `healthy` (an `unhealthy` fails at once);
 *   - the service's port accepts a TCP connection from the edge's side of the
 *     network (the proxy's view: a process bound to 127.0.0.1, or listening on
 *     the wrong port, is NOT ready, however healthy it looks from inside);
 *   - and it stays that way for {@link READY_HOLD_MS}, so a process that serves
 *     for two seconds and then exits is a crash loop, not a success.
 *
 * Anything else inside the bounded window is "waiting"; past the window, or on
 * a crash / failed healthcheck, it is "failed" with a reason written for the
 * person reading the deployment ("nothing is listening on port 3000", not
 * "convergence failed").
 */

/** How long a new version may take to become ready when it declares no
 *  healthcheck. Generous for a cold JVM or a first migration, short enough that
 *  a broken deploy fails in minutes, not never. */
export const DEFAULT_READY_TIMEOUT_MS = 120_000;
/** Added on top of a declared healthcheck's own worst case (start period plus
 *  every retry), so a check that passes on its last allowed attempt still wins. */
export const HEALTHCHECK_READY_MARGIN_MS = 60_000;
/** No readiness window is longer than this, whatever the healthcheck says. */
export const MAX_READY_TIMEOUT_MS = 20 * 60_000;
/** A new version must stay ready this long before traffic moves to it. Same
 *  10 s the swarm rollout's `UpdateConfig.Monitor` watches a new task for. */
export const READY_HOLD_MS = 10_000;
/** This many restarts while being watched is a crash loop, not a slow boot. */
export const READY_MAX_RESTARTS = 3;
/** Poll interval of the readiness loop. */
export const READY_POLL_MS = 1_000;
/** A progress line goes to the deployment log this often while waiting, so a
 *  slow boot reads as "still waiting for :3000", not as a hung deploy. */
export const READY_PROGRESS_EVERY_MS = 15_000;

export interface ReadinessHealthcheck {
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
}

export interface ReadinessPlan {
  /** Give up after this long. */
  timeoutMs: number;
  /** Must stay ready this long. */
  holdMs: number;
  /** TCP port the edge must be able to reach; null when the service declares none. */
  port: number | null;
  /** True when the container carries a declared healthcheck. */
  healthcheck: boolean;
}

/** Result of one edge-side TCP connect. `unavailable` = the probe itself could
 *  not run (no edge container, no `nc` in it): the port gate is then skipped,
 *  never failed, so missing tooling cannot block a deploy. */
export type PortProbe = "open" | "closed" | "unavailable";

export interface ReadinessObservation {
  elapsedMs: number;
  /** Docker container state (`running`, `restarting`, `exited`, …), `missing`
   *  when the container is gone. */
  state: string;
  exitCode: number | null;
  restartCount: number;
  oomKilled: boolean;
  health: "starting" | "healthy" | "unhealthy" | null;
  /** Output of the latest healthcheck run, when there is one. */
  healthOutput: string | null;
  /** This round's port probe; null when the plan has no port. */
  port: PortProbe | null;
}

/** What the gate remembers between polls: when the current ready streak began,
 *  and the restart count it began at. */
export interface ReadinessTrack {
  readySinceMs: number | null;
  restartsAtReady: number;
  /** The last exit code seen: a restarted container reports none while it
   *  runs again, and the crash-loop reason should still name it. */
  lastExitCode: number | null;
}

export type ReadinessVerdict =
  | { kind: "waiting"; track: ReadinessTrack }
  | { kind: "ready" }
  | { kind: "failed"; reason: string };

export const READINESS_START: ReadinessTrack = {
  readySinceMs: null,
  restartsAtReady: 0,
  lastExitCode: null,
};

/** The readiness window for a service: the default without a healthcheck, the
 *  healthcheck's own worst case plus a margin with one, capped either way. */
export function readinessPlan(input: {
  healthcheck: ReadinessHealthcheck | null;
  port: number | null;
}): ReadinessPlan {
  const hc = input.healthcheck;
  const declared = hc
    ? hc.startPeriodMs +
      (hc.intervalMs + hc.timeoutMs) * (hc.retries + 1) +
      HEALTHCHECK_READY_MARGIN_MS
    : 0;
  return {
    timeoutMs: Math.min(MAX_READY_TIMEOUT_MS, Math.max(DEFAULT_READY_TIMEOUT_MS, declared)),
    holdMs: READY_HOLD_MS,
    port: input.port,
    healthcheck: hc !== null,
  };
}

/** The port a service is reached on: its primary port, else its first TCP
 *  port; null for a worker that declares none (or UDP only). */
export function readinessPort(
  ports: ReadonlyArray<{ containerPort: number; protocol: string; isPrimary?: boolean }>,
): number | null {
  const tcp = ports.filter((p) => p.protocol === "tcp");
  return (tcp.find((p) => p.isPrimary) ?? tcp[0])?.containerPort ?? null;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function exitText(exitCode: number | null): string {
  return exitCode === null ? "exited" : `exited with code ${exitCode}`;
}

/** A crash, an OOM kill or a failed healthcheck: fails at once, whatever is
 *  left of the window. Null when none of those happened. */
function hardFailure(
  plan: ReadinessPlan,
  o: ReadinessObservation,
  exitCode: number | null,
): string | null {
  if (o.state === "missing") return "the new container disappeared before it became ready";
  if (o.oomKilled) return "was killed for running out of memory (OOM) before it became ready";
  if (o.state === "exited" || o.state === "dead") {
    const restarts = o.restartCount > 0 ? ` after ${o.restartCount} restarts` : "";
    return `crashed: ${exitText(exitCode)}${restarts} before it became ready`;
  }
  if (o.restartCount >= READY_MAX_RESTARTS) {
    return `kept crashing: ${exitText(exitCode)} and restarted ${o.restartCount} times before it became ready`;
  }
  if (plan.healthcheck && o.health === "unhealthy") {
    const output = o.healthOutput?.trim();
    return `failed its healthcheck${output ? `: ${output.slice(0, 300)}` : ""}`;
  }
  return null;
}

function isReadyNow(plan: ReadinessPlan, o: ReadinessObservation): boolean {
  if (o.state !== "running") return false;
  if (plan.healthcheck && o.health !== "healthy") return false;
  return plan.port === null || o.port !== "closed";
}

/** Why the window ran out, from the last thing seen. */
function timeoutReason(plan: ReadinessPlan, o: ReadinessObservation): string {
  const window = seconds(plan.timeoutMs);
  if (o.state !== "running") return `never became ready: still ${o.state} after ${window}`;
  if (plan.healthcheck && o.health !== "healthy") {
    return `never became healthy within ${window} (healthcheck still ${o.health ?? "not reporting"})`;
  }
  if (plan.port !== null && o.port === "closed") {
    return `never became ready: nothing accepted a connection on port ${plan.port} within ${window}`;
  }
  return `never stayed ready for ${seconds(plan.holdMs)} within ${window}`;
}

/** One step of the gate. */
export function assessReadiness(
  plan: ReadinessPlan,
  o: ReadinessObservation,
  track: ReadinessTrack,
): ReadinessVerdict {
  const lastExitCode = o.exitCode ?? track.lastExitCode;
  const failure = hardFailure(plan, o, lastExitCode);
  if (failure) return { kind: "failed", reason: failure };

  if (isReadyNow(plan, o)) {
    // A restart since the streak began means it went down in between: the
    // streak starts over from this observation.
    const fresh = track.readySinceMs === null || o.restartCount !== track.restartsAtReady;
    const next: ReadinessTrack = fresh
      ? { readySinceMs: o.elapsedMs, restartsAtReady: o.restartCount, lastExitCode }
      : { ...track, lastExitCode };
    if (o.elapsedMs - (next.readySinceMs ?? o.elapsedMs) >= plan.holdMs) return { kind: "ready" };
    if (o.elapsedMs >= plan.timeoutMs + plan.holdMs) {
      return { kind: "failed", reason: timeoutReason(plan, o) };
    }
    return { kind: "waiting", track: next };
  }

  if (o.elapsedMs >= plan.timeoutMs) return { kind: "failed", reason: timeoutReason(plan, o) };
  return { kind: "waiting", track: { ...READINESS_START, lastExitCode } };
}

// ─── listening sockets (the "why" behind a closed port) ──────────────────

export interface Listener {
  address: string;
  port: number;
}

const TCP_LISTEN = "0A";

function ipv4(hex: string): string {
  // /proc/net/tcp prints the address in host (little-endian) byte order.
  const bytes = hex.match(/../g) ?? [];
  return bytes
    .map((b) => Number.parseInt(b, 16))
    .toReversed()
    .join(".");
}

function ipv6(hex: string): string {
  if (/^0{32}$/.test(hex)) return "::";
  if (hex === "00000000000000000000000001000000") return "::1";
  // IPv4-mapped (::ffff:a.b.c.d): the last word is the v4 address.
  if (hex.startsWith("0000000000000000FFFF0000")) return `::ffff:${ipv4(hex.slice(24))}`;
  return hex.toLowerCase();
}

/** Listening TCP sockets from `/proc/net/tcp` + `/proc/net/tcp6` text. */
export function parseListeners(text: string): Listener[] {
  const out: Listener[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const local = fields[1];
    if (!local || fields[3] !== TCP_LISTEN) continue;
    const [addr, portHex] = local.split(":");
    if (!addr || !portHex) continue;
    const port = Number.parseInt(portHex, 16);
    if (!Number.isFinite(port)) continue;
    const address = addr.length === 8 ? ipv4(addr) : ipv6(addr.toUpperCase());
    if (!out.some((l) => l.address === address && l.port === port)) out.push({ address, port });
  }
  return out;
}

function isLoopback(address: string): boolean {
  return address.startsWith("127.") || address === "::1" || address.startsWith("::ffff:127.");
}

function isWildcard(address: string): boolean {
  return address === "0.0.0.0" || address === "::";
}

/** Can the edge reach `port`, judged from the container's own listening
 *  sockets? The fallback when the edge-side probe cannot run. */
export function listenerProbe(listeners: Listener[], port: number): PortProbe {
  return listeners.some((l) => l.port === port && !isLoopback(l.address)) ? "open" : "closed";
}

function hostPort(l: Listener): string {
  return l.address.includes(":") ? `[${l.address}]:${l.port}` : `${l.address}:${l.port}`;
}

/**
 * The actionable half of a "nothing on port N" failure: what the app IS
 * listening on. Null when nothing can be said (no listener list).
 */
export function describeListeners(listeners: Listener[] | null, port: number): string | null {
  if (listeners === null) return null;
  const onPort = listeners.filter((l) => l.port === port);
  if (onPort.length > 0 && onPort.every((l) => isLoopback(l.address))) {
    return `port ${port} is bound to ${onPort[0]?.address ?? "127.0.0.1"} only, so nothing outside the container can reach it: listen on 0.0.0.0:${port}`;
  }
  const elsewhere = listeners.filter(
    (l) => l.port !== port && (isWildcard(l.address) || !isLoopback(l.address)),
  );
  if (elsewhere.length > 0) {
    return `the app is listening on ${elsewhere.map(hostPort).join(", ")} instead: make it listen on port ${port} (or change the service's port)`;
  }
  return "the app is not listening on any TCP port";
}
