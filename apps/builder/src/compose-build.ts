import type { DeploymentId } from "@otterdeploy/shared/id";

import { deployCompose } from "@otterdeploy/api/routers/compose/deploy";
import { extendsFileRefs, resolveSiblingPath } from "@otterdeploy/api/stack/compose/extends";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
import { summarizeCompose } from "@otterdeploy/api/stack/compose/summary";
import { db } from "@otterdeploy/db";
import { composeResource, deployment, resource } from "@otterdeploy/db/schema";
import { COMPOSE_FILENAMES } from "@otterdeploy/shared/compose";
/**
 * Build path for `type: compose` resources with `build:` services.
 *
 * Clones the repo once, reads the compose file, and builds each `build:`
 * context to its own image (reusing dockerfileBuild/railpackBuild per
 * subdirectory: they already support `sourceSubdir` + distinct tags). The
 * built tags + the fetched file + the parse summary are written back onto the
 * compose_resource, then the api deploy applies the whole stack against THIS
 * build's deployment row. Image-only stacks never reach here (they deploy
 * straight from `compose.create`). See docs/designs/compose.md.
 *
 * The DB context load + build-tree acquisition (clone vs. inline materialize)
 * live in ./compose-source.ts. This file is the pipeline only.
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

    // Source the build tree (inline materialize vs. git clone, see
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
    const candidates = [ctx.compose.composePath, ...COMPOSE_FILENAMES].filter(
      (p): p is string => !!p,
    );
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

    // `extends: { file: ... }` bases live next to the compose file in the same
    // checkout, so unlike the wizard's preview this call CAN resolve them.
    // Upstream stacks that are almost entirely `extends` (PostHog's hobby file)
    // parse to nothing without this.
    const siblings = await readExtendsFiles(join(workDir, subdir), { path: found, content }, sink);

    const parsed = parseCompose(content, { files: siblings });
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
      // A service may declare BOTH a published `image` and a `build` context —
      // upstream projects do it so contributors can build locally while
      // everyone else pulls. When the context isn't in this checkout the build
      // cannot run at all, and failing the deploy would be the wrong answer
      // while a perfectly good image ref sits right there. Compose behaves the
      // same way on `up`: the image wins when it resolves.
      //
      // Deliberately narrow. A context that DOES exist is still built, so an
      // app repo that names its own output image (`image: myapp:latest`,
      // `build: .`) keeps deploying its own code.
      if (svc.image && !existsSync(join(workDir, subdir, svc.build.context))) {
        sink.system(
          `${svc.name}: build context "${svc.build.context}" not in this repo; using declared image ${svc.image}`,
        );
        continue;
      }
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
          .where(eq(composeResource.resourceId, ctx.resource.id)),
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
            projectId: ctx.project.id,
            resourceId: ctx.resource.id,
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
    // `failed`, but with ownsDeployment=false it can't settle THIS row, so the
    // worker must fail it here. Without this the deployment is marked "running"
    // over an empty shell (the pull error is swallowed as a false success).
    if (outcome.status !== "running") {
      const detail = outcome.failed.length
        ? `${outcome.failed.join(", ")} failed to start`
        : "no services became healthy";
      return Result.err(
        new BuildStepError({
          step: "deploy",
          cause: new Error(`stack deploy ${outcome.status}: ${detail}`),
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

/**
 * Load every compose file reachable from the entry file through
 * `extends: { file }`, keyed by path relative to the entry file's own
 * directory — the spelling `parseCompose`'s `files` option looks them up by.
 *
 * Breadth-first because a base file may extend a third; `seen` keeps a diamond
 * (twenty services extending one base, which extends another) to one read each
 * and stops a cyclic include from looping here rather than in the resolver.
 *
 * Best-effort by design: an unreadable base is skipped, and `parseCompose` then
 * reports it as the precise "extends the file X, which was not provided" error
 * against the service that wanted it. That names the service and the path,
 * which a bare read failure surfaced from here could not.
 */
async function readExtendsFiles(
  dir: string,
  entry: { path: string; content: string },
  sink: LogSink,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const seen = new Set<string>([entry.path]);
  let frontier = [entry];

  while (frontier.length > 0) {
    const next: Array<{ path: string; content: string }> = [];
    for (const file of frontier) {
      for (const ref of extendsFileRefs(file.content)) {
        const path = resolveSiblingPath(file.path, ref);
        if (seen.has(path)) continue;
        seen.add(path);
        // A missing base is not this walker's error to raise (see above), so
        // the Result is inspected and dropped rather than propagated.
        const read = await Result.tryPromise({
          try: () => readFile(join(dir, path), "utf8"),
          catch: (cause) => cause,
        });
        if (read.isErr()) {
          sink.system(`compose: could not read extends target "${path}"`);
          continue;
        }
        out[path] = read.value;
        next.push({ path, content: read.value });
      }
    }
    frontier = next;
  }
  return out;
}
