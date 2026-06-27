import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { getInstallationToken } from "@otterdeploy/api/git/github-app";
import { deployCompose } from "@otterdeploy/api/routers/compose/deploy";
import { parseCompose } from "@otterdeploy/api/stack/compose/parse";
import { summarizeCompose } from "@otterdeploy/api/stack/compose/summary";
import { db } from "@otterdeploy/db";
import {
  composeResource,
  containerRegistry,
  deployment,
  project,
  resource,
} from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
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
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { ensureBuildxBuilder } from "./buildx";
import { cloneRepoAtSha } from "./clone";
import { buildComposeService } from "./compose-build-service";
import { BuildStepError, InvalidDeploymentError } from "./errors";
import { PipelineLoadError } from "./load";
import { markBuilding, markImageReady, markRunning } from "./state";

interface ComposeBuildContext {
  deployment: typeof deployment.$inferSelect;
  resource: typeof resource.$inferSelect;
  compose: typeof composeResource.$inferSelect;
  project: typeof project.$inferSelect;
  registry: typeof containerRegistry.$inferSelect | null;
  /** Base image repository (no tag, no per-service suffix). */
  imageRepository: string;
  /** Clone URL — the compose row's own repo (public). */
  cloneUrl: string;
  installationId: string | null;
}

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

async function loadComposeBuildContext(deploymentId: DeploymentId): Promise<ComposeBuildContext> {
  const [dep] = await db.select().from(deployment).where(eq(deployment.id, deploymentId)).limit(1);
  if (!dep) throw new PipelineLoadError("deployment", `${deploymentId} missing`);

  const [res] = await db.select().from(resource).where(eq(resource.id, dep.resourceId)).limit(1);
  if (!res) throw new PipelineLoadError("resource", `${dep.resourceId} missing`);

  const [comp] = await db
    .select()
    .from(composeResource)
    .where(eq(composeResource.resourceId, res.id))
    .limit(1);
  if (!comp) {
    throw new PipelineLoadError("compose", `compose_resource ${res.id} missing`);
  }

  const [proj] = await db.select().from(project).where(eq(project.id, res.projectId)).limit(1);
  if (!proj) throw new PipelineLoadError("project", `${res.projectId} missing`);

  // Compose brings its OWN repo url (public clone, anonymous).
  if (!comp.gitRepoUrl) {
    throw new PipelineLoadError("compose.gitRepoUrl", `${comp.resourceId} has no repo url`);
  }

  let registry: typeof containerRegistry.$inferSelect | null = null;
  let imageRepository: string;
  if (proj.containerRegistryId && proj.imageRepository) {
    const [reg] = await db
      .select()
      .from(containerRegistry)
      .where(eq(containerRegistry.id, proj.containerRegistryId))
      .limit(1);
    if (!reg) throw new PipelineLoadError("registry", "registry row missing");
    registry = reg;
    imageRepository = proj.imageRepository;
  } else {
    imageRepository = `otterdeploy-local/${comp.stackName.toLowerCase()}`;
  }

  return {
    deployment: dep,
    resource: res,
    compose: comp,
    project: proj,
    registry,
    imageRepository,
    cloneUrl: comp.gitRepoUrl,
    installationId: null,
  };
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

    let installationToken = "";
    if (ctx.installationId) {
      const minted = yield* await Result.tryPromise({
        try: () => getInstallationToken(ctx.installationId as string),
        catch: (cause) => new BuildStepError({ step: "token", cause }),
      });
      installationToken = minted.token;
    }

    const cloned = yield* await Result.tryPromise({
      try: () =>
        cloneRepoAtSha({
          cloneUrl: ctx.cloneUrl,
          ref: gitRef,
          sha: gitSha,
          projectId: ctx.project.id as ProjectId,
          deploymentId: opts.deploymentId,
          installationToken,
          // Compose stacks bind a public repo URL (installationId is always
          // null), so clone failures stay generic.
          bindingKind: "public_url",
          sink,
        }),
      catch: (cause) => new BuildStepError({ step: "clone", cause }),
    });
    work.path = cloned.workDir;

    // Resolve the compose file: the explicit path if set, else the common
    // names (compose.yml / docker-compose.yml / .yaml), relative to subdir.
    const subdir = ctx.compose.sourceSubdir ?? "";
    const candidates = [
      ctx.compose.composePath,
      "compose.yml",
      "compose.yaml",
      "docker-compose.yml",
      "docker-compose.yaml",
    ].filter((p): p is string => !!p);
    const found = candidates.find((p) => existsSync(join(cloned.workDir, subdir, p)));
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
      try: () => readFile(join(cloned.workDir, subdir, found), "utf8"),
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
        workDir: cloned.workDir,
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

    // Apply the stack against THIS deployment row (ownsDeployment=false →
    // deployCompose won't open a second deployment or flip status; the build
    // worker's mark-running does that).
    yield* await Result.tryPromise({
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

    yield* await Result.tryPromise({
      try: () => markRunning(opts.deploymentId),
      catch: (cause) => new BuildStepError({ step: "mark-running", cause }),
    });

    return Result.ok(ctx.compose.stackName);
  });
}
