import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { deployCompose } from "@otterdeploy/api/routers/compose/deploy";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
import { summarizeCompose } from "@otterdeploy/api/stack/compose/summary";
import { db } from "@otterdeploy/db";
import { composeResource, deployment, resource } from "@otterdeploy/db/schema";
/**
 * Build path for `type: compose` resources with `build:` services.
 *
 * Clones the repo once, reads the compose file, and builds each `build:`
 * context to its own image (reusing dockerfileBuild/railpackBuild per
 * subdirectory — they already support `sourceSubdir` + distinct tags). The
 * built tags + the fetched file + the parse summary are written back onto the
 * compose_resource, then the api deploy applies the whole stack against THIS
 * build's deployment row. Image-only stacks never reach here (they deploy
 * straight from `compose.create`). See docs/designs/compose.md.
 *
 * The DB context load + build-tree acquisition (clone vs. inline materialize)
 * live in ./compose-source.ts — this file is the pipeline only.
 */
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { ensureBuildxBuilder } from "./buildx";
import { buildComposeService } from "./compose-build-service";
import { acquireComposeSource, loadComposeBuildContext } from "./compose-source";
import { BuildStepError, InvalidDeploymentError } from "./errors";
import { PipelineLoadError } from "./load";
import { markBuilding, markImageReady, markRunning } from "./state";

/** True when the deployment's resource is a compose stack (drives dispatch). */
export async function isComposeDeployment(deploymentId: DeploymentId): Promise<boolean> {
  const [row] = await db
    .select({ type: resource.type })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  return row?.type === "compose";
}

export async function runComposeBuild(
  opts: { deploymentId: DeploymentId },
  sink: LogSink,
  work: { path: string | null },
): Promise<Result<string, PipelineLoadError | BuildStepError | InvalidDeploymentError>> {
  return Result.gen(async function* () {
    const ctx = yield* await Result.tryPromise({
      try: () => loadComposeBuildContext(opts.deploymentId),
      catch: (cause) =>
        cause instanceof PipelineLoadError ? cause : new BuildStepError({ step: "load", cause }),
    });

    yield* await Result.tryPromise({
      try: () => markBuilding(opts.deploymentId),
      catch: (cause) => new BuildStepError({ step: "mark-building", cause }),
    });

    const { gitSha, gitRef } = ctx.deployment;
    if (!gitSha || !gitRef) {
      return Result.err(new InvalidDeploymentError(opts.deploymentId));
    }

    // Source the build tree (inline materialize vs. git clone — see
    // acquireComposeSource). Everything downstream is source-agnostic.
    const { workDir, subdir } = yield* await acquireComposeSource({
      ctx,
      deploymentId: opts.deploymentId,
      gitRef,
      gitSha,
      sink,
    });
    work.path = workDir;

    // Resolve the compose file: the explicit path if set, else the common
    // names (compose.yml / docker-compose.yml / .yaml), relative to subdir.
    const candidates = [
      ctx.compose.composePath,
      "compose.yml",
      "compose.yaml",
      "docker-compose.yml",
      "docker-compose.yaml",
    ].filter((p): p is string => !!p);
    const found = candidates.find((p) => existsSync(join(workDir, subdir, p)));
    if (!found) {
      return Result.err(
        new BuildStepError({
          step: "find-compose",
          cause: new Error(`No compose file found (tried ${candidates.join(", ")})`),
        }),
      );
    }
    sink.system(`using compose file: ${join(subdir, found)}`);
    const content = yield* await Result.tryPromise({
      try: () => readFile(join(workDir, subdir, found), "utf8"),
      catch: (cause) => new BuildStepError({ step: "read-compose", cause }),
    });

    const parsed = parseCompose(content);
    if (parsed.isErr()) {
      return Result.err(
        new BuildStepError({
          step: "parse-compose",
          cause: new Error(parsed.error.message),
        }),
      );
    }

    // Best-effort persistent layer cache, shared across this stack's services
    // (each keyed by its own image repo below). Null → no cache, default build.
    const cacheBuilder = await ensureBuildxBuilder(sink);

    // Build each `build:` service to its own image; image-only services pass
    // through untouched.
    const builtImages: Record<string, string> = {};
    for (const svc of parsed.value.services) {
      if (!svc.build) continue;
      builtImages[svc.name] = yield* await buildComposeService({
        serviceName: svc.name,
        build: svc.build,
        imageRepository: ctx.imageRepository,
        registry: ctx.registry,
        workDir,
        gitSha,
        cacheBuilder,
        sink,
      });
    }

    // Persist the fetched file, summary, and built tags so the api deploy reads
    // a complete, image-resolved stack.
    yield* await Result.tryPromise({
      try: () =>
        db
          .update(composeResource)
          .set({
            composeContent: content,
            services: summarizeCompose(parsed.value),
            builtImages,
          })
          .where(eq(composeResource.resourceId, ctx.resource.id as ResourceId)),
      catch: (cause) => new BuildStepError({ step: "set-compose", cause }),
    });

    yield* await Result.tryPromise({
      try: () => markImageReady(opts.deploymentId, ctx.compose.stackName),
      catch: (cause) => new BuildStepError({ step: "image-ready", cause }),
    });
    // Images built; the stack rollout below is the deploy phase.
    sink.setPhase("deploy");

    // Apply the stack against THIS deployment row (ownsDeployment=false →
    // deployCompose won't open a second deployment or settle status; the build
    // worker settles it below, based on the reported outcome).
    const outcome = yield* await Result.tryPromise({
      try: async () => {
        const r = await deployCompose(
          {
            projectId: ctx.project.id as ProjectId,
            resourceId: ctx.resource.id as ResourceId,
            deploymentId: opts.deploymentId,
          },
          "redeploy",
        );
        if (r.isErr()) throw new Error(r.error.message);
        return r.value;
      },
      catch: (cause) => new BuildStepError({ step: "deploy", cause }),
    });

    // A service whose image never becomes runnable (e.g. a registry-less local
    // build that swarm can't pull on the scheduling node) leaves its swarm
    // service with 0 running tasks. deployCompose reports that as `partial` or
    // `failed`, but with ownsDeployment=false it can't settle THIS row — so the
    // worker must fail it here. Without this the deployment is marked "running"
    // over an empty shell (the pull error is swallowed as a false success).
    if (outcome.status !== "running") {
      const detail = outcome.failed.length
        ? `${outcome.failed.join(", ")} failed to start`
        : "no services became healthy";
      return Result.err(
        new BuildStepError({
          step: "deploy",
          cause: new Error(`stack deploy ${outcome.status} — ${detail}`),
        }),
      );
    }

    yield* await Result.tryPromise({
      try: () => markRunning(opts.deploymentId),
      catch: (cause) => new BuildStepError({ step: "mark-running", cause }),
    });

    return Result.ok(ctx.compose.stackName);
  });
}
