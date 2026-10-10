import type {
  EnvironmentId,
  GitRepoId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
/**
 * Reconcile a compose stack declared in the project manifest. Called by the
 * manifest reconciler (routers/project/manifest-apply.ts) when a `compose`
 * create change is applied. The staged-then-Deploy twin of the one-shot
 * `compose.create` handler.
 *
 * The manifest stages the stack (the compose_resource row + its swarm services
 * don't exist yet. Only the manifest entry does); THIS is where the row is
 * created and the stack deployed. Inline stacks deploy here; git stacks enqueue
 * a build that deploys on completion. Failures fold into a ManifestApplySkipError
 * so a bad stack doesn't abort the whole apply. See docs/designs/compose.md.
 */
import { Result } from "better-result";

import type { ComposeManifest } from "../../stack/manifest";

import { fetchBranchHead } from "../../git/github-app";
import { resolveRepoCloneBinding } from "../../git/repo-binding";
import { resolveBuildLane } from "../../lib/build-target";
import { resolveRuntimeScope } from "../../lib/environment/runtime-scope";
import { scopeSuffix } from "../../lib/environment/scoping";
import { parseCompose, summarizeCompose } from "../../stack/compose";
import { ManifestApplySkipError } from "../project/errors";
import { getProjectInOrg } from "../project/queries";
import { isUniqueViolation } from "../project/views";
import { enqueueInlineComposeBuild } from "./build-trigger";
import { deployCompose } from "./deploy";
import { manifestStackVariables } from "./manifest-reconcile-env";
import { createComposeRecord } from "./queries";
import { parseGitHubUrl, pickComposeFile, stackNameFor } from "./util";

interface CreateComposeArgs {
  /** Machine every child of this stack is seeded onto; resolved from the
   *  manifest's portable `server: "<name>"` by the apply phase. Typed off the
   *  query it feeds so the two cannot drift. */
  placementServerId: Parameters<typeof createComposeRecord>[0]["placementServerId"];
  projectId: ProjectId;
  /** Environment the apply runs in. The stack row is stamped with it and its
   *  stack name (the identity its containers and volumes derive from) takes
   *  that environment's suffix. */
  environmentId: EnvironmentId;
  organizationId: OrganizationId;
  name: string;
  spec: ComposeManifest;
  log: RequestLogger;
}

type GitManifest = Extract<ComposeManifest, { source: "git" }>;
type InlineManifest = Extract<ComposeManifest, { source: "inline" }>;

interface ExposedSeed {
  service: string;
  port: number;
  domain: string;
}

type CreateResult = Result<{ resourceId: ResourceId }, ManifestApplySkipError>;

const skip = (name: string, reason: string) =>
  Result.err(new ManifestApplySkipError({ resource: "compose", name, reason }));

interface GitSourceBinding {
  owner: string;
  repoName: string;
  cloneUrl: string;
  gitRepoId: GitRepoId | null;
  installationId: string | null;
}

/** Prefer the bound repo (private-capable); fall back to a legacy public URL. */
async function resolveGitSource(
  spec: GitManifest,
  name: string,
  organizationId: OrganizationId,
): Promise<Result<GitSourceBinding, ManifestApplySkipError>> {
  const boundRepoId = spec.gitRepoId?.trim();
  if (boundRepoId) {
    if (!hasPrefix(boundRepoId, ID_PREFIX.gitRepo)) {
      return skip(name, `not a git repo id: ${boundRepoId}`);
    }
    const bound = await Result.tryPromise({
      try: () => resolveRepoCloneBinding(boundRepoId, organizationId),
      catch: (e) => (e instanceof Error ? e.message : String(e)),
    });
    if (bound.isErr()) return skip(name, bound.error);
    return Result.ok({
      owner: bound.value.owner,
      repoName: bound.value.repo,
      cloneUrl: bound.value.cloneUrl,
      gitRepoId: bound.value.gitRepoId,
      installationId: bound.value.githubInstallationId,
    });
  }
  const gh = parseGitHubUrl(spec.gitRepoUrl ?? "");
  if (!gh) return skip(name, `not a cloneable GitHub URL: ${spec.gitRepoUrl ?? ""}`);
  return Result.ok({
    owner: gh.owner,
    repoName: gh.repo,
    cloneUrl: gh.cloneUrl,
    gitRepoId: null,
    installationId: null,
  });
}

/** Git source: enqueue a build that deploys on completion. */
async function createGitStackFromManifest(
  args: CreateComposeArgs,
  spec: GitManifest,
  exposed: ExposedSeed[],
  stackName: string,
): Promise<CreateResult> {
  const { projectId, organizationId, name, log } = args;

  const source = await resolveGitSource(spec, name, organizationId);
  if (source.isErr()) return Result.err(source.error);
  const { owner, repoName, cloneUrl, gitRepoId, installationId } = source.value;

  const branch = spec.gitRef?.trim() || "main";
  const headRes = await Result.tryPromise({
    try: () => fetchBranchHead(installationId, owner, repoName, branch),
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });
  if (headRes.isErr()) {
    return skip(name, `couldn't resolve ${branch} on ${owner}/${repoName}: ${headRes.error}`);
  }
  const head = headRes.value;
  const ref = `refs/heads/${branch}`;

  const created = await Result.tryPromise({
    try: () =>
      createComposeRecord({
        projectId,
        // Stamp the environment the apply runs in, like every other manifest
        // create. This used to be the project's MAIN environment whatever was
        // being applied, so a staging apply wrote its stack into production,
        // or collided with production's stack of the same name (od-5tgf).
        environmentId: args.environmentId,
        name,
        source: "git",
        composeContent: null,
        gitRepoId,
        gitRepoUrl: cloneUrl,
        gitRef: ref,
        composePath: spec.composePath?.trim() || null,
        sourceSubdir: spec.sourceSubdir?.trim() || null,
        stackName,
        services: [],
        exposed,
        logoBrand: spec.logoBrand ?? null,
        placementServerId: args.placementServerId,
        variables: manifestStackVariables(spec),
      }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
  if (created.isErr()) {
    return skip(
      name,
      isUniqueViolation(created.error)
        ? "a resource with that name already exists"
        : created.error.message,
    );
  }

  const [dep] = await db
    .insert(deployment)
    .values({
      resourceId: created.value.resource.id,
      image: `pending:${head.sha.slice(0, 12)}`,
      reason: "create",
      status: "pending",
      gitSha: head.sha,
      gitRef: ref,
      gitCommitMessage: head.message,
      gitCommitAuthor: head.authorName,
      gitCommitAuthorAvatar: head.authorAvatar,
    })
    .returning({ id: deployment.id });

  await triggerDeploy(
    {
      projectId,
      // Real binding when picked (correlation); else the resource id.
      gitRepoId: gitRepoId ?? created.value.resource.id,
      ref,
      sha: head.sha,
      deploymentIds: [dep?.id ?? ""],
    },
    undefined,
    // Route to the project's build server lane, if it has a dedicated one.
    await resolveBuildLane(projectId),
  );
  log.set({ manifestComposeBuild: { resourceId: created.value.resource.id, ref } });
  return Result.ok({ resourceId: created.value.resource.id });
}

/** Inline source: parse + create the row, then deploy now. */
async function createInlineStackFromManifest(
  args: CreateComposeArgs,
  spec: InlineManifest,
  exposed: ExposedSeed[],
  stackName: string,
): Promise<CreateResult> {
  const { projectId, name, log } = args;
  // Multi-file: the compose file is one entry in `files`; single-file: `content`.
  const files = spec.files ?? [];
  const picked = files.length > 0 ? pickComposeFile(files, spec.composePath) : null;
  const composeContent = picked?.content ?? spec.content;
  const composePath = picked?.path ?? spec.composePath ?? null;
  const parsed = parseCompose(composeContent);
  if (parsed.isErr()) return skip(name, parsed.error.message);
  const services = summarizeCompose(parsed.value);

  const created = await Result.tryPromise({
    try: () =>
      createComposeRecord({
        projectId,
        // See the git branch above, same reason.
        environmentId: args.environmentId,
        name,
        source: "inline",
        composeContent,
        files,
        composePath,
        stackName,
        services,
        exposed,
        logoBrand: spec.logoBrand ?? null,
        placementServerId: args.placementServerId,
        variables: manifestStackVariables(spec),
      }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
  if (created.isErr()) {
    return skip(
      name,
      isUniqueViolation(created.error)
        ? "a resource with that name already exists"
        : created.error.message,
    );
  }

  // `build:` services can't deploy directly (no image yet). Route through the
  // build worker (materializes the file tree, builds, deploys on completion).
  if (services.some((s) => s.hasBuild)) {
    const enq = await enqueueInlineComposeBuild({
      projectId,
      resourceId: created.value.resource.id,
      composeContent,
      reason: "create",
    });
    if (enq.isErr()) return skip(name, `created but build enqueue failed: ${enq.error}`);
    return Result.ok({ resourceId: created.value.resource.id });
  }

  const deployed = await deployCompose(
    { projectId, resourceId: created.value.resource.id },
    "create",
    log,
  );
  if (deployed.isErr()) {
    // The row + manifest entry remain so the stack shows on the graph and can
    // be redeployed; surface why the rollout didn't land.
    return skip(name, `created but deploy failed: ${deployed.error.message}`);
  }
  if (deployed.value.status === "failed") {
    return skip(name, `deploy failed: ${deployed.value.failed.join(", ")} did not roll out`);
  }
  return Result.ok({ resourceId: created.value.resource.id });
}

export async function createComposeFromManifest(args: CreateComposeArgs): Promise<CreateResult> {
  const { projectId, organizationId, name, spec } = args;

  const project = await getProjectInOrg({ projectId, organizationId });
  if (!project) return skip(name, "project not found");

  const exposed: ExposedSeed[] = (spec.exposed ?? []).map((e) => ({
    service: e.service,
    port: e.port,
    domain: e.domain ?? "",
  }));
  // The stack name is global (compose_resource_stack_name_unique) and every
  // child container and named volume derives from it, so a non-main
  // environment's stack takes the environment suffix: otherwise staging's
  // stack would claim production's volumes, or fail on production's name.
  // Main renders as base, so a deployed stack keeps the name it has.
  const suffix = scopeSuffix(
    await resolveRuntimeScope({ projectId, environmentId: args.environmentId }),
  );
  const stackName = stackNameFor(project.slug, `${name}${suffix}`);

  return spec.source === "git"
    ? createGitStackFromManifest(args, spec, exposed, stackName)
    : createInlineStackFromManifest(args, spec, exposed, stackName);
}
