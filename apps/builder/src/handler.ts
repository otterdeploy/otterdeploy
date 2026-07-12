/**
 * The `deploy.triggered` BullMQ handler — replaces the stub in
 * `packages/jobs/src/jobs/deploy.ts`. Iterates the deployments named in the
 * payload and builds each in its own throwaway helper container, in series.
 *
 * Coolify-style per-build isolation: rather than running the build pipeline
 * in-process, the worker spawns a fresh `docker run --rm` container per
 * deployment (see build-one.ts) and waits for it to exit. The container
 * carries the railpack/docker toolchain and holds its own DB + Redis handles,
 * so it marks deployment state and streams logs itself — the worker only
 * reads the exit code. A build that crashes, leaks disk, or OOMs takes its
 * container down with it, never the long-lived worker; the clone lives in the
 * container's filesystem and is gone the moment `--rm` fires.
 *
 * Series rather than parallel because docker builds of unrelated services on
 * the same daemon contend for it and the layer cache more than they
 * parallelize. Cross-deployment parallelism is the job of more builder hosts
 * (or bumping BUILDER_CONCURRENCY).
 */

import type { DeploymentId, ProjectId } from "@otterdeploy/shared/id";

import { reportPreviewBuildOutcome } from "@otterdeploy/api/git/preview-report";
import { env } from "@otterdeploy/env/server";
import { defineJob } from "@otterdeploy/jobs";
import { DeployTriggeredPayload, deployTriggeredJob } from "@otterdeploy/jobs/jobs/deploy";
import { DATA_ROOT, sourceTarballPath } from "@otterdeploy/shared/paths";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { getDeploymentStatus, markFailed } from "./state";

/** Env keys forwarded by name into the helper container (`docker run -e KEY`
 *  passes the worker's current value). Only those actually set are forwarded —
 *  the rest fall back to the env schema's defaults inside the helper.
 *  OTTERDEPLOY_DATA_DIR rides along so the helper resolves the SAME DATA_ROOT as
 *  the host — the buildx cache path + bind mount below must agree. */
const FORWARDED_ENV = [
  "DATABASE_URL",
  "DATABASE_PROVISIONER_URL",
  "REDIS_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "CORS_ORIGIN",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "PUBLIC_WEB_URL",
  "NODE_ENV",
  "OTTERDEPLOY_DATA_DIR",
] as const;

/** Host dir holding the persistent BuildKit layer cache + buildx instance state
 *  (see buildx.ts). Bind-mounted into each helper at the same path so the cache
 *  survives the `--rm`, and shared by every build on this host. */
const CACHE_ROOT = join(DATA_ROOT, "buildx-cache");

interface HelperResult {
  exitCode: number;
  /** Combined stdout+stderr tail — worker-level diagnostics only; the real
   *  build logs are published to Redis/DB from inside the container. */
  tail: string;
}

/** Human-readable cause for a helper exit code, used when the pipeline never
 *  wrote a terminal status itself. 125/126/127 are docker-run's own "the
 *  container never started" codes; 137/143 are kill signals (128+SIGKILL /
 *  128+SIGTERM) — a 137 mid-build is almost always the kernel OOM killer. */
function classifyHelperExit(exitCode: number): string {
  if (exitCode === HELPER_TIMED_OUT) {
    return `build exceeded the ${HELPER_TIMEOUT_MS / 60_000}-minute limit and was killed`;
  }
  if (exitCode === 125 || exitCode === 126 || exitCode === 127) {
    return `build container failed to start (exit ${exitCode})`;
  }
  if (exitCode === 137) {
    return "build was killed (exit 137, likely out of memory) before it could finish";
  }
  if (exitCode === 143) {
    return "build was terminated (exit 143, SIGTERM — host shutdown or manual stop)";
  }
  return `build process died (exit ${exitCode}) without reporting a failure`;
}

/** Hard wall-clock cap on one helper build. Without it, a `docker run` that
 *  wedges (daemon hiccup, a build step blocked on a dead network read) holds
 *  the worker slot forever and the deployment sits "building" with no
 *  terminal write. Generous: real builds finish way inside this; anything
 *  past it is stuck, not slow. */
const HELPER_TIMEOUT_MS = 45 * 60_000;

/** Sentinel exitCode for a build we killed at the timeout wall. */
const HELPER_TIMED_OUT = -2;

/** Spawn the per-deployment helper container and resolve once it exits.
 *  For a `source: "upload"` build, `sourceTarball` is the host path of the
 *  staged tarball; it's bind-mounted into the helper at the same path so the
 *  pipeline's extract step can read it (the helper does NOT mount DATA_ROOT, so
 *  the tarball must be mounted explicitly — same-path, docker-out-of-docker). */
function runHelperContainer(
  deploymentId: DeploymentId,
  opts: { sourceTarball?: string } = {},
): Promise<HelperResult> {
  const envFlags = FORWARDED_ENV.filter(
    // eslint-disable-next-line node/no-process-env
    (key) => process.env[key] !== undefined,
  ).flatMap((key) => ["-e", key]);

  // Mount the staged source tarball read-only at its own host path so the
  // extract step finds it (the bind source resolves on the host daemon). Gated
  // on the file existing on the host — no data folder ⇒ no tarball ⇒ the build
  // fails with a clear "uploaded source not found" from extract.ts.
  const sourceFlags =
    opts.sourceTarball && existsSync(opts.sourceTarball)
      ? ["-v", `${opts.sourceTarball}:${opts.sourceTarball}:ro`]
      : [];

  // Persist the BuildKit layer cache + the buildx instance registration across
  // these throwaway containers, but only when the data folder is actually
  // present (prod / data-folder hosts). The bind source resolves on the HOST
  // daemon (docker-out-of-docker), so the path must exist on the host — which,
  // for the compose builder service, means DATA_ROOT is mounted into it too.
  // Absent (dev) → no flags → builds run with no persistent cache, unchanged.
  const cacheFlags = existsSync(DATA_ROOT)
    ? [
        "-v",
        `${CACHE_ROOT}:${CACHE_ROOT}`,
        "-e",
        `BUILDX_CONFIG=${join(CACHE_ROOT, ".buildx-state")}`,
      ]
    : [];

  const args = [
    "run",
    "--rm",
    "--name",
    `otterbuild-${deploymentId}`,
    "--network",
    env.BUILDER_HELPER_NETWORK,
    // Docker-out-of-Docker: the build's `buildx --load` and swarm calls speak
    // to the host daemon through this socket — same one the worker uses.
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    ...cacheFlags,
    ...sourceFlags,
    ...envFlags,
    env.BUILDER_HELPER_IMAGE,
    "bun",
    "run",
    "src/build-one.ts",
    deploymentId,
  ];

  return new Promise<HelperResult>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    let timedOut = false;
    const TAIL_CAP = 16 * 1024;
    const append = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-TAIL_CAP);
    };
    // At the wall: remove the named container on the daemon (which unblocks the
    // `docker run` attach) and kill the local process as a belt-and-braces.
    const timer = setTimeout(() => {
      timedOut = true;
      spawn("docker", ["rm", "-f", `otterbuild-${deploymentId}`], { stdio: "ignore" }).on(
        "error",
        () => undefined,
      );
      child.kill("SIGKILL");
    }, HELPER_TIMEOUT_MS);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? HELPER_TIMED_OUT : (code ?? -1), tail });
    });
  });
}

export function makeBuildJob() {
  return defineJob({
    name: deployTriggeredJob.name,
    schema: DeployTriggeredPayload,
    opts: deployTriggeredJob.opts,
    async handler(payload, { log }) {
      log.info({
        build: {
          event: "received",
          projectId: payload.projectId,
          gitRepoId: payload.gitRepoId,
          sha: payload.sha,
          deploymentCount: payload.deploymentIds.length,
        },
      });

      const results: Array<{ deploymentId: string; ok: boolean; error?: string }> = [];

      // The pipeline converges the row to a terminal status (running/failed)
      // itself, so a helper that exits — with ANY code — while the row is
      // still `pending`/`building` died before converging it: a no-op build
      // (redundant deploy of an already-built SHA), a docker start failure
      // (125/126/127), or a silent event-loop-drain death (Bun 1.3.14
      // intermittently drops a DB/Redis promise during client warm-up and
      // exits before markBuilding — observed on ~8-24% of helper runs). The
      // drain death is random and nothing was built or marked, so re-run the
      // helper once before repairing the row to a visible failure — never
      // strand a phantom `pending`/`building` row with an empty log pane.
      const MAX_ATTEMPTS = 2;

      for (const id of payload.deploymentIds) {
        const deploymentId = id as DeploymentId;
        // Upload builds: the staged tarball is bind-mounted into the helper.
        const sourceTarball =
          payload.sourceKind === "tarball"
            ? sourceTarballPath(payload.projectId as ProjectId, deploymentId)
            : undefined;
        let outcome: { ok: boolean; error?: string } = { ok: false, error: "not attempted" };

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const { exitCode, tail } = await runHelperContainer(deploymentId, { sourceTarball });
            const status = await getDeploymentStatus(deploymentId).catch(() => null);
            const unconverged = status === "pending" || status === "building";

            if (unconverged && attempt < MAX_ATTEMPTS) {
              log.warn({
                build: { event: "retry-unconverged", deploymentId, exitCode, attempt },
              });
              continue;
            }
            if (unconverged) {
              await markFailed(
                deploymentId,
                exitCode === 0
                  ? "build helper exited 0 but the deployment never converged (no image produced)"
                  : `${classifyHelperExit(exitCode)}: ${tail.trim().slice(-500)}`,
              ).catch(() => undefined);
              outcome = { ok: false, error: "did not converge" };
            } else if (exitCode === 0) {
              outcome = { ok: true };
            } else {
              // build-one.ts exits 1 after the pipeline has already marked
              // the row failed — the row is terminal, just report it.
              outcome = { ok: false, error: `build exited ${exitCode}` };
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await markFailed(deploymentId, `failed to spawn build container: ${message}`).catch(
              () => undefined,
            );
            outcome = { ok: false, error: message };
          }
          break;
        }

        // Reclaim the staged tarball now that every attempt is done (the worker
        // has DATA_ROOT mounted read-write; the helper only had it read-only).
        if (sourceTarball) await rm(sourceTarball, { force: true }).catch(() => undefined);

        results.push({ deploymentId: id, ...outcome });
        // Preview deploys converge their PR comment + commit status here, the
        // one place that sees every terminal outcome (pipeline success, build
        // failure, container that never started). No-op for non-preview
        // deployments; never throws.
        await reportPreviewBuildOutcome(deploymentId);
      }

      log.info({
        build: {
          event: "batch-complete",
          projectId: payload.projectId,
          sha: payload.sha,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
      });
      return { results };
    },
  });
}
