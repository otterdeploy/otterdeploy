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

import { spawn } from "node:child_process";

import type { DeploymentId } from "@otterdeploy/shared/id";

import { env } from "@otterdeploy/env/server";
import { defineJob } from "@otterdeploy/jobs";
import { DeployTriggeredPayload, deployTriggeredJob } from "@otterdeploy/jobs/jobs/deploy";

import { markFailed } from "./state";

/** Env keys forwarded by name into the helper container (`docker run -e KEY`
 *  passes the worker's current value). Only those actually set are forwarded —
 *  the rest fall back to the env schema's defaults inside the helper. */
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
] as const;

interface HelperResult {
  exitCode: number;
  /** Combined stdout+stderr tail — worker-level diagnostics only; the real
   *  build logs are published to Redis/DB from inside the container. */
  tail: string;
}

/** Spawn the per-deployment helper container and resolve once it exits. */
function runHelperContainer(deploymentId: DeploymentId): Promise<HelperResult> {
  const envFlags = FORWARDED_ENV.filter(
    // eslint-disable-next-line node/no-process-env
    (key) => process.env[key] !== undefined,
  ).flatMap((key) => ["-e", key]);

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
    const TAIL_CAP = 16 * 1024;
    const append = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-TAIL_CAP);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? -1, tail }));
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

      for (const id of payload.deploymentIds) {
        const deploymentId = id as DeploymentId;
        let outcome: { ok: boolean; error?: string };
        try {
          const { exitCode, tail } = await runHelperContainer(deploymentId);
          if (exitCode === 0) {
            outcome = { ok: true };
          } else {
            // build-one.ts exits 1 after the pipeline has already marked the
            // row failed. Docker's own 125/126/127 mean the container never
            // ran the build (bad image / command / network), so nothing marked
            // the row — do it here as a fallback so it doesn't hang "building".
            if (exitCode === 125 || exitCode === 126 || exitCode === 127) {
              await markFailed(
                deploymentId,
                `build container failed to start (exit ${exitCode}): ${tail.trim().slice(-500)}`,
              ).catch(() => undefined);
            }
            outcome = { ok: false, error: `build exited ${exitCode}` };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await markFailed(
            deploymentId,
            `failed to spawn build container: ${message}`,
          ).catch(() => undefined);
          outcome = { ok: false, error: message };
        }
        results.push({ deploymentId: id, ...outcome });
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
