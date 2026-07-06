import type { GitRepoId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { triggerDeploy } from "@otterdeploy/jobs";
/**
 * Reconcile a compose stack declared in the project manifest. Called by the
 * manifest reconciler (routers/project/manifest-apply.ts) when a `compose`
 * create change is applied — the staged-then-Deploy twin of the one-shot
 * `compose.create` handler.
 *
 * The manifest stages the stack (the compose_resource row + its swarm services
 * don't exist yet — only the manifest entry does); THIS is where the row is
 * created and the stack deployed. Inline stacks deploy here; git stacks enqueue
 * a build that deploys on completion. Failures fold into a ManifestApplySkipError
 * so a bad stack doesn't abort the whole apply. See docs/designs/compose.md.
 */
import { Result } from "better-result";

import type { ComposeManifest } from "../../stack/manifest";

import { fetchBranchHeadSha } from "../../git/github-app";
import { resolveRepoCloneBinding } from "../../git/repo-binding";
import { parseCompose, summarizeCompose } from "../../stack/compose";
import { ManifestApplySkipError } from "../project/errors";
import { getProjectInOrg, upsertProjectEnvVar } from "../project/queries";
import { isUniqueViolation } from "../project/views";
import { deployCompose } from "./deploy";
import { createComposeRecord } from "./queries";
import { parseGitHubUrl, SECRETISH, stackNameFor } from "./util";

interface CreateComposeArgs {
  projectId: ProjectId;
  organizationId: OrganizationId;
  name: string;
  spec: ComposeManifest;
  log: RequestLogger;
}

type ManifestProject = NonNullable<Awaited<ReturnType<typeof getProjectInOrg>>>;
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

/**
 * Persist the stack's `${VAR}` values as project variables so the compose
 * interpolation (and any later redeploy) resolves them. The manifest is the
 * source of truth for these at create time; thereafter they're owned by the
 * project's variable cascade.
 */
async function persistManifestEnv(
  spec: ComposeManifest,
  projectId: ProjectId,
  project: ManifestProject,
): Promise<void> {
  if (!spec.env || !project.environmentId) return;
  for (const [key, value] of Object.entries(spec.env)) {
    if (!value) continue;
    await upsertProjectEnvVar({
      scope: { projectId, environmentId: project.environmentId },
      key,
      value,
      isSecret: SECRETISH.test(key),
    });
  }
}

/** Git source: enqueue a build that deploys on completion. */
async function createGitStackFromManifest(
  args: CreateComposeArgs,
  spec: GitManifest,
  _project: ManifestProject,
  exposed: ExposedSeed[],
  stackName: string,
): Promise<CreateResult> {
  const { projectId, name, log } = args;

  // Prefer the bound repo (private-capable); fall back to a legacy public URL.
  let owner: string;
  let repoName: string;
  let cloneUrl: string;
  let gitRepoId: string | null = null;
  let installationId: string | null = null;
  if (spec.gitRepoId?.trim()) {
    const bound = await Result.tryPromise({
      try: () => resolveRepoCloneBinding(spec.gitRepoId!.trim() as GitRepoId),
      catch: (e) => (e instanceof Error ? e.message : String(e)),
    });
    if (bound.isErr()) return skip(name, bound.error);
    owner = bound.value.owner;
    repoName = bound.value.repo;
    cloneUrl = bound.value.cloneUrl;
    gitRepoId = bound.value.gitRepoId;
    installationId = bound.value.githubInstallationId;
  } else {
    const gh = parseGitHubUrl(spec.gitRepoUrl ?? "");
    if (!gh) return skip(name, `not a cloneable GitHub URL: ${spec.gitRepoUrl ?? ""}`);
    owner = gh.owner;
    repoName = gh.repo;
    cloneUrl = gh.cloneUrl;
  }

  const branch = spec.gitRef?.trim() || "main";
  const shaRes = await Result.tryPromise({
    try: () => fetchBranchHeadSha(installationId, owner, repoName, branch),
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });
  if (shaRes.isErr()) {
    return skip(name, `couldn't resolve ${branch} on ${owner}/${repoName}: ${shaRes.error}`);
  }
  const ref = `refs/heads/${branch}`;

  const created = await Result.tryPromise({
    try: () =>
      createComposeRecord({
        projectId,
        name,
        source: "git",
        composeContent: null,
        gitRepoId: gitRepoId as GitRepoId | null,
        gitRepoUrl: cloneUrl,
        gitRef: ref,
        composePath: spec.composePath?.trim() || null,
        sourceSubdir: spec.sourceSubdir?.trim() || null,
        stackName,
        services: [],
        exposed,
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
      image: `pending:${shaRes.value.slice(0, 12)}`,
      reason: "create",
      status: "pending",
      gitSha: shaRes.value,
      gitRef: ref,
    })
    .returning({ id: deployment.id });

  await triggerDeploy({
    projectId,
    // Real binding when picked (correlation); else the resource id.
    gitRepoId: gitRepoId ?? created.value.resource.id,
    ref,
    sha: shaRes.value,
    deploymentIds: [dep?.id ?? ""],
  });
  log.set({ manifestComposeBuild: { resourceId: created.value.resource.id, ref } });
  return Result.ok({ resourceId: created.value.resource.id as ResourceId });
}

/** Inline source: parse + create the row, then deploy now. */
async function createInlineStackFromManifest(
  args: CreateComposeArgs,
  spec: InlineManifest,
  exposed: ExposedSeed[],
  stackName: string,
): Promise<CreateResult> {
  const { projectId, name, log } = args;
  const parsed = parseCompose(spec.content);
  if (parsed.isErr()) return skip(name, parsed.error.message);
  const services = summarizeCompose(parsed.value);

  const created = await Result.tryPromise({
    try: () =>
      createComposeRecord({
        projectId,
        name,
        source: "inline",
        composeContent: spec.content,
        stackName,
        services,
        exposed,
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

  const deployed = await deployCompose(
    { projectId, resourceId: created.value.resource.id as ResourceId },
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
  return Result.ok({ resourceId: created.value.resource.id as ResourceId });
}

export async function createComposeFromManifest(args: CreateComposeArgs): Promise<CreateResult> {
  const { projectId, organizationId, name, spec } = args;

  const project = await getProjectInOrg({ projectId, organizationId });
  if (!project) return skip(name, "project not found");

  await persistManifestEnv(spec, projectId, project);

  const exposed: ExposedSeed[] = (spec.exposed ?? []).map((e) => ({
    service: e.service,
    port: e.port,
    domain: e.domain ?? "",
  }));
  const stackName = stackNameFor(project.slug, name);

  return spec.source === "git"
    ? createGitStackFromManifest(args, spec, project, exposed, stackName)
    : createInlineStackFromManifest(args, spec, exposed, stackName);
}
