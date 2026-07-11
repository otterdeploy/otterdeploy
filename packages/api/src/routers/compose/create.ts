/**
 * Compose `create` orchestration — extracted from index.ts so the oRPC handler
 * stays a thin Result→error translation. The one-shot twin of the staged
 * manifest path in manifest-reconcile.ts. See docs/designs/compose.md.
 */
import type { ComposeFile, ComposeServiceSummary } from "@otterdeploy/shared/compose";
import type { GitRepoId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { fetchBranchHeadSha } from "../../git/github-app";
import { resolveRepoCloneBinding } from "../../git/repo-binding";
import { getProjectInOrg, upsertProjectEnvVar } from "../project/queries";
import { isUniqueViolation } from "../project/views";
import { enqueueComposeBuild } from "./build-trigger";
import { createInlineCompose } from "./create-inline";
import { createComposeRecord } from "./queries";
import { parseGitHubUrl, SECRETISH, stackNameFor } from "./util";

export type ComposeProject = NonNullable<Awaited<ReturnType<typeof getProjectInOrg>>>;

export interface ComposeCreateInput {
  projectId: ProjectId;
  name?: string;
  source: "inline" | "git";
  composeContent?: string;
  files?: ComposeFile[];
  gitRepoId?: string;
  gitRepoUrl?: string;
  gitRef?: string;
  composePath?: string;
  sourceSubdir?: string;
  variables: Array<{ key: string; value: string; secret?: boolean }>;
  exposed: Array<{ service: string; port: number }>;
  deploy: boolean;
}

export interface ExposedSeed {
  service: string;
  port: number;
  domain: string;
}

export interface ComposeCreateOutput {
  resourceId: ResourceId;
  services: ComposeServiceSummary[];
  warnings: string[];
  deploy: { ok: boolean; error: string | null; status: string };
}

/** Translation targets for the oRPC handler — kept structural so the handler
 *  owns the wire-level error codes (NOT_FOUND / CONFLICT / INVALID_INPUT). */
export type ComposeCreateFailure =
  | { reason: "not_found" }
  | { reason: "conflict" }
  | { reason: "invalid"; message: string };

const invalid = (message: string): ComposeCreateFailure => ({ reason: "invalid", message });

/**
 * Persist the filled-in `${VAR}` values as project variables so the compose
 * interpolation (and any future redeploy) resolves them. Applies to both
 * inline and git sources.
 */
async function persistComposeVariables(
  input: ComposeCreateInput,
  project: ComposeProject,
): Promise<void> {
  if (input.variables.length === 0 || !project.environmentId) return;
  for (const v of input.variables) {
    if (!v.value) continue;
    await upsertProjectEnvVar({
      scope: { projectId: input.projectId, environmentId: project.environmentId },
      key: v.key,
      value: v.value,
      isSecret: v.secret ?? SECRETISH.test(v.key),
    });
  }
}

/** Git source: build the stack from a bound repo (private-capable via the
 *  GitHub App installation) or, legacy, a pasted public URL. */
async function createGitCompose(
  input: ComposeCreateInput,
  project: ComposeProject,
  exposed: ExposedSeed[],
): Promise<Result<ComposeCreateOutput, ComposeCreateFailure>> {
  // Prefer the bound repo (repo picker) — resolves owner/repo + installation so
  // private repos clone with a token. Fall back to a pasted public URL.
  let owner: string;
  let repoName: string;
  let cloneUrl: string;
  let gitRepoId: string | null = null;
  let installationId: string | null = null;

  const boundRepoId = input.gitRepoId?.trim();
  if (boundRepoId) {
    const bound = await Result.tryPromise({
      try: () => resolveRepoCloneBinding(boundRepoId as GitRepoId),
      catch: (e) => (e instanceof Error ? e.message : String(e)),
    });
    if (bound.isErr()) return Result.err(invalid(bound.error));
    owner = bound.value.owner;
    repoName = bound.value.repo;
    cloneUrl = bound.value.cloneUrl;
    gitRepoId = bound.value.gitRepoId;
    installationId = bound.value.githubInstallationId;
  } else {
    const gh = parseGitHubUrl(input.gitRepoUrl ?? "");
    if (!gh) {
      return Result.err(
        invalid(
          "Pick a repository, or enter a public GitHub URL like https://github.com/owner/repo",
        ),
      );
    }
    owner = gh.owner;
    repoName = gh.repo;
    cloneUrl = gh.cloneUrl;
  }

  // Name from the user, else the repo name.
  const name = input.name?.trim() || repoName;
  const stackName = stackNameFor(project.slug, name);
  const branch = input.gitRef?.trim() || "main";
  const shaRes = await Result.tryPromise({
    try: () => fetchBranchHeadSha(installationId, owner, repoName, branch),
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });
  if (shaRes.isErr()) {
    return Result.err(
      invalid(`Couldn't resolve ${branch} on ${owner}/${repoName}: ${shaRes.error}`),
    );
  }
  const ref = `refs/heads/${branch}`;

  const created = await Result.tryPromise({
    try: () =>
      createComposeRecord({
        projectId: input.projectId,
        name,
        source: "git",
        composeContent: null,
        gitRepoId: gitRepoId as GitRepoId | null,
        gitRepoUrl: cloneUrl,
        gitRef: ref,
        // null → the build worker auto-detects common compose file names.
        composePath: input.composePath?.trim() || null,
        sourceSubdir: input.sourceSubdir?.trim() || null,
        stackName,
        services: [],
        exposed,
      }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
  if (created.isErr()) {
    if (isUniqueViolation(created.error)) return Result.err({ reason: "conflict" });
    throw created.error;
  }

  await enqueueComposeBuild({
    projectId: input.projectId,
    resourceId: created.value.resource.id,
    gitRepoUrl: cloneUrl,
    gitRef: ref,
    // Real binding id when picked (drives the private clone in the builder);
    // null for a legacy public-URL stack.
    gitRepoId: gitRepoId as GitRepoId | null,
    reason: "create",
    sha: shaRes.value,
  });

  return Result.ok({
    resourceId: created.value.resource.id,
    services: [],
    warnings: [],
    deploy: { ok: true, error: null, status: "building" },
  });
}

/**
 * Create a `type: compose` resource (inline or git) and, for inline stacks,
 * deploy it immediately. Returns a structural failure the oRPC handler maps to
 * the right wire error.
 */
export async function createComposeResource(args: {
  input: ComposeCreateInput;
  organizationId: OrganizationId;
  log: RequestLogger;
}): Promise<Result<ComposeCreateOutput, ComposeCreateFailure>> {
  const { input, organizationId, log } = args;

  const project = await getProjectInOrg({ projectId: input.projectId, organizationId });
  if (!project) return Result.err({ reason: "not_found" });

  await persistComposeVariables(input, project);

  const exposed: ExposedSeed[] = input.exposed.map((e) => ({
    service: e.service,
    port: e.port,
    domain: "",
  }));

  return input.source === "git"
    ? createGitCompose(input, project, exposed)
    : createInlineCompose(input, project, exposed, log);
}
