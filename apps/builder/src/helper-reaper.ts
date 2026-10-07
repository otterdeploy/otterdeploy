/**
 * Stale and orphaned build helpers.
 *
 * A helper is a separate container named `otterbuild-<deploymentId>` that the
 * builder starts with `docker run --rm` and waits on. When the builder itself
 * dies mid-build (SIGKILL, OOM, a host restart of just that container), the
 * helper keeps running with nobody waiting on it. Two things then went wrong:
 *
 *   - BullMQ redelivers the stalled job to the restarted builder, whose
 *     `docker run --name otterbuild-<same id>` fails at once with "Conflict.
 *     The container name ... is already in use" (exit 125). The retry failed
 *     the deployment for a reason that had nothing to do with the build.
 *   - Nothing ever removed the orphan, so it kept building (and could later
 *     write a status over the row the retry had already failed).
 *
 * Now the redelivered job adopts a helper of its deployment that is still
 * running (handler.ts waits on it, the build keeps its progress), removes one
 * that exists but no longer runs, and the builder sweeps helpers whose
 * deployment is no longer in flight, at boot and on the reconcile cadence. A
 * helper of a still-in-flight deployment is left alone by the sweep: another
 * builder on the same daemon may own it.
 */
import type { DeploymentId } from "@otterdeploy/shared/id";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { spawn } from "node:child_process";

import { HELPER_NAME_PREFIX, helperContainerName } from "./helper-args";

/** A docker CLI call: exit code + stdout. */
export interface DockerOutcome {
  code: number;
  stdout: string;
}

export type DockerCli = (args: string[]) => Promise<DockerOutcome>;

/** Deployment statuses a helper may still be working for. */
const IN_FLIGHT = new Set(["pending", "building"]);

/** A docker CLI call (ps / inspect / rm) that has not answered in this long
 *  is a wedged daemon: give up rather than hold the job or the sweep. */
export const DOCKER_CLI_TIMEOUT_MS = 30_000;

/** A CLI on `bin`, never rejecting: a spawn failure or a call past
 *  `timeoutMs` (killed) reads as exit -1. */
export function createDockerCli(bin = "docker", timeoutMs = DOCKER_CLI_TIMEOUT_MS): DockerCli {
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ code: -1, stdout });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout });
      });
    });
}

/** The host's docker CLI. */
const dockerCli: DockerCli = createDockerCli();

/** Whether this deployment's helper container exists, and runs. */
export async function helperState(
  deploymentId: DeploymentId,
  docker: DockerCli = dockerCli,
): Promise<"absent" | "running" | "stale"> {
  const inspected = await docker([
    "inspect",
    "--format",
    "{{.State.Status}}",
    helperContainerName(deploymentId),
  ]);
  if (inspected.code !== 0) return "absent";
  return inspected.stdout.trim() === "running" ? "running" : "stale";
}

/** Force-remove the helper of `deploymentId` if one is left over. Answers
 *  whether a container was removed; "no such container" is the usual case. */
export async function removeStaleHelper(
  deploymentId: DeploymentId,
  docker: DockerCli = dockerCli,
): Promise<boolean> {
  const removed = await docker(["rm", "-f", helperContainerName(deploymentId)]);
  return removed.code === 0 && removed.stdout.trim().length > 0;
}

/** The deployment ids of every helper container on this daemon, any state.
 *  Names that do not parse as a deployment id are not ours and are skipped. */
export async function listHelperDeployments(
  docker: DockerCli = dockerCli,
): Promise<DeploymentId[]> {
  const listed = await docker([
    "ps",
    "-a",
    "--filter",
    `name=^${HELPER_NAME_PREFIX}`,
    "--format",
    "{{.Names}}",
  ]);
  if (listed.code !== 0) return [];
  return listed.stdout
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name.startsWith(HELPER_NAME_PREFIX))
    .flatMap((name) => {
      const parsed = idSchema.deployment.safeParse(name.slice(HELPER_NAME_PREFIX.length));
      return parsed.success ? [parsed.data] : [];
    });
}

/**
 * Remove every helper whose deployment is no longer in flight (terminal, or
 * gone). Returns the removed deployment ids. A status that cannot be read
 * (DB down) keeps the helper: never reap on a guess.
 */
export async function reapOrphanHelpers(deps: {
  status: (id: DeploymentId) => Promise<string | null>;
  docker?: DockerCli;
}): Promise<DeploymentId[]> {
  const docker = deps.docker ?? dockerCli;
  const reaped: DeploymentId[] = [];
  for (const id of await listHelperDeployments(docker)) {
    const status = await Result.tryPromise({
      try: () => deps.status(id),
      catch: (cause) => cause,
    });
    if (status.isErr() || (status.value !== null && IN_FLIGHT.has(status.value))) continue;
    if (await removeStaleHelper(id, docker)) reaped.push(id);
  }
  return reaped;
}
