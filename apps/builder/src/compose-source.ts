/**
 * Where a compose build gets its inputs: the DB context for one stack
 * deployment, and the on-disk build tree that context points at.
 *
 * Split out of compose-build.ts so that file is only the PIPELINE (mark →
 * find → parse → build → persist → deploy → settle). Both jobs here answer the
 * same question — "what is this stack, and where does its code live?" — and
 * both are the only places that care about the stack's SOURCE (inline file tree
 * vs. bound git repo vs. legacy public URL). Everything downstream of
 * {@link acquireComposeSource} is source-agnostic, so keeping the fork here
 * stops it from leaking branches into the pipeline body.
 */

import type { DeploymentId, ProjectId } from "@otterdeploy/shared/id";

import { getInstallationToken } from "@otterdeploy/api/git/github-app";
import { resolveRepoCloneBinding } from "@otterdeploy/api/git/repo-binding";
import { materializeComposeFiles } from "@otterdeploy/api/lib/compose-materialize";
import { db } from "@otterdeploy/db";
import {
  composeResource,
  containerRegistry,
  deployment,
  project,
  resource,
} from "@otterdeploy/db/schema";
import { buildDir } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { LogSink } from "./log-stream";

import { cloneRepoAtSha } from "./clone";
import { BuildStepError } from "./errors";
import { PipelineLoadError } from "./load";

export interface ComposeBuildContext {
  deployment: typeof deployment.$inferSelect;
  resource: typeof resource.$inferSelect;
  compose: typeof composeResource.$inferSelect;
  project: typeof project.$inferSelect;
  registry: typeof containerRegistry.$inferSelect | null;
  /** Base image repository (no tag, no per-service suffix). */
  imageRepository: string;
  /** Clone URL — the bound repo's clone URL, or the row's legacy public URL. */
  cloneUrl: string;
  /** GitHub NUMERIC installation id (private repos), else null (anonymous). */
  installationId: string | null;
  /** Whether the bound repo is private — drives the clone bindingKind. */
  isPrivate: boolean;
}

export async function loadComposeBuildContext(
  deploymentId: DeploymentId,
): Promise<ComposeBuildContext> {
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

  // Resolve the clone binding: a picked repo (gitRepoId) resolves owner/repo +
  // the numeric installation id so PRIVATE repos clone with a token; a legacy
  // stack clones its stored public URL anonymously. INLINE stacks (multi-file,
  // routed here for their `build:` services) have no repo — the builder
  // materializes their stored file tree instead of cloning.
  let cloneUrl = "";
  let installationId: string | null = null;
  let isPrivate = false;
  if (comp.source === "inline") {
    // no clone — files are materialized in acquireComposeSource.
  } else if (comp.gitRepoId) {
    const bound = await resolveRepoCloneBinding(comp.gitRepoId);
    cloneUrl = bound.cloneUrl;
    installationId = bound.githubInstallationId;
    isPrivate = bound.isPrivate;
  } else if (comp.gitRepoUrl) {
    cloneUrl = comp.gitRepoUrl;
  } else {
    throw new PipelineLoadError("compose.gitRepoUrl", `${comp.resourceId} has no repo binding`);
  }

  // Compose stacks build registry-less local images: the project no longer
  // carries a registry FK (push credentials are resolved from the shared
  // container_registry library by the image's host string at build time), and
  // compose_resource binds no registry of its own — so every `build:` service
  // lands in the host daemon under a stack-derived repo. Image-only services
  // pass through untouched. See docs/designs/compose.md.
  const registry: typeof containerRegistry.$inferSelect | null = null;
  const imageRepository = `otterdeploy-local/${comp.stackName.toLowerCase()}`;

  return {
    deployment: dep,
    resource: res,
    compose: comp,
    project: proj,
    registry,
    imageRepository,
    cloneUrl,
    installationId,
    isPrivate,
  };
}

/**
 * Source the build tree for one compose stack and report where the compose file
 * should be resolved from: INLINE stacks materialize their stored file tree (no
 * repo, so no subdir either), git stacks clone at the pinned SHA — minting an
 * installation token first when the bound repo is private.
 */
export async function acquireComposeSource(input: {
  ctx: ComposeBuildContext;
  deploymentId: DeploymentId;
  gitRef: string;
  gitSha: string;
  sink: LogSink;
}): Promise<Result<{ workDir: string; subdir: string }, BuildStepError>> {
  const { ctx, sink } = input;
  return Result.gen(async function* () {
    if (ctx.compose.source === "inline") {
      const workDir = yield* await Result.tryPromise({
        try: () =>
          materializeComposeFiles(
            ctx.compose.files,
            buildDir(ctx.project.id as ProjectId, input.deploymentId),
          ),
        catch: (cause) => new BuildStepError({ step: "materialize", cause }),
      });
      sink.system(`materialized ${ctx.compose.files.length} inline file(s)`);
      return Result.ok({ workDir, subdir: "" });
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
          ref: input.gitRef,
          sha: input.gitSha,
          projectId: ctx.project.id as ProjectId,
          deploymentId: input.deploymentId,
          installationToken,
          // Private bound repos surface an installation-specific clone-failure
          // hint; public/legacy stacks stay generic.
          bindingKind: ctx.installationId && ctx.isPrivate ? "github_app" : "public_url",
          sink,
        }),
      catch: (cause) => new BuildStepError({ step: "clone", cause }),
    });
    return Result.ok({ workDir: cloned.workDir, subdir: ctx.compose.sourceSubdir ?? "" });
  });
}
