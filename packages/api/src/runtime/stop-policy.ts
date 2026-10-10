/**
 * How long, and with which signal, the plain-Docker runtime stops a container.
 *
 * A container that is killed instead of stopped cannot finish what it was
 * doing: a Postgres killed mid-checkpoint starts again into crash recovery,
 * and a stack's database child that lost its WAL tail panics with "could not
 * locate a valid checkpoint record". Docker's default grace is
 * 10 s, which a database with a large checkpoint or a volume-backed app with a
 * slow flush does not always make. So:
 *
 *   - a service that keeps state on a volume gets STATEFUL_STOP_GRACE_S;
 *   - a managed database gets DATABASE_STOP_GRACE_S;
 *   - a compose file's `stop_grace_period` / `stop_signal` win over both;
 *   - everything else keeps docker's 10 s.
 *
 * The value is also written into the container as StopTimeout, so it governs
 * every stop of that container, including the docker daemon stopping it when
 * the host shuts down or reboots.
 *
 * The grace is a ceiling, not a delay: a process that exits on the signal is
 * stopped at once. One that never sees it (a shell script as PID 1, such as
 * the Postgres image's entrypoint in the seconds it is still running initdb)
 * waits the whole grace on every stop, which is why these are tens of seconds
 * and not minutes: a longer value turned a restart right after a database was
 * created into a 120 s call that hit the API's own 120 s timeout. A compose
 * file that needs minutes says so with stop_grace_period.
 */
import type { Docker } from "@otterdeploy/docker";

import type { ContainerSpec } from "./types";

import { keepsState } from "./exclusive-rollout";

/** Docker's own default: the stateless service. */
export const DEFAULT_STOP_GRACE_S = 10;
/** A service with a writable volume or bind. */
export const STATEFUL_STOP_GRACE_S = 30;
/** A managed database: its shutdown checkpoint scales with the data. */
export const DATABASE_STOP_GRACE_S = 60;

/** Whole seconds for a duration in ms; docker takes integer seconds, at least 1. */
function wholeSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Seconds between the stop signal and the kill for a service container. */
export function serviceStopGraceSeconds(
  spec: Pick<ContainerSpec, "mounts" | "stopGracePeriodMs">,
): number {
  if (spec.stopGracePeriodMs != null && spec.stopGracePeriodMs > 0)
    return wholeSeconds(spec.stopGracePeriodMs);
  return spec.mounts.some(keepsState) ? STATEFUL_STOP_GRACE_S : DEFAULT_STOP_GRACE_S;
}

/** The container-create fields that make docker stop it the way the spec says. */
export function stopConfig(
  spec: Pick<ContainerSpec, "mounts" | "stopGracePeriodMs" | "stopSignal">,
): { StopTimeout: number; StopSignal?: string } {
  return {
    StopTimeout: serviceStopGraceSeconds(spec),
    ...(spec.stopSignal ? { StopSignal: spec.stopSignal } : {}),
  };
}

/**
 * Stop a container and give it time to exit on its own: SIGTERM (or its
 * StopSignal), then SIGKILL only after the grace runs out. The grace is the
 * longer of the one the container was created with (StopTimeout) and
 * `minimumGraceS`, so a container made before the runtime knew about stateful
 * grace periods still gets the new spec's, on the redeploy that replaces it.
 * Never rejects: a stop that fails (already exited, never started) leaves the
 * caller's remove or rename to say what is wrong.
 */
export async function stopContainerGracefully(
  docker: Docker,
  id: string,
  minimumGraceS = 0,
): Promise<void> {
  const inspected = await docker.containers.inspect(id);
  const own = inspected.isOk() ? inspected.value.Config?.StopTimeout : undefined;
  const grace = Math.max(own != null && own > 0 ? own : DEFAULT_STOP_GRACE_S, minimumGraceS);
  await docker.containers.getContainer(id).stop({ t: grace });
}
