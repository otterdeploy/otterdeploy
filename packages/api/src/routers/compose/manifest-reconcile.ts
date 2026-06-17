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
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import type {
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";
import { triggerDeploy } from "@otterdeploy/jobs";

import type { ComposeManifest } from "../../stack/manifest";
import { parseCompose, summarizeCompose } from "../../stack/compose";
import { fetchBranchHeadSha } from "../../git/github-app";
import { getProjectInOrg, upsertProjectEnvVar } from "../project/queries";
import { ManifestApplySkipError } from "../project/errors";
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

const skip = (name: string, reason: string) =>
  Result.err(new ManifestApplySkipError({ resource: "compose", name, reason }));

export async function createComposeFromManifest(
  args: CreateComposeArgs,
): Promise<Result<{ resourceId: ResourceId }, ManifestApplySkipError>> {
  const { projectId, organizationId, name, spec, log } = args;

  const project = await getProjectInOrg({ projectId, organizationId });
  if (!project) return skip(name, "project not found");

  // Persist the stack's `${VAR}` values as project variables so the compose
  // interpolation (and any later redeploy) resolves them. The manifest is the
  // source of truth for these at create time; thereafter they're owned by the
  // project's variable cascade.
  if (spec.env && project.environmentId) {
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

  const exposed = (spec.exposed ?? []).map((e) => ({
    service: e.service,
    port: e.port,
    domain: e.domain ?? "",
  }));
  const stackName = stackNameFor(project.slug, name);

  // ── Git source: enqueue a build that deploys on completion. ──
  if (spec.source === "git") {
    const gh = parseGitHubUrl(spec.gitRepoUrl);
    if (!gh) return skip(name, `not a cloneable GitHub URL: ${spec.gitRepoUrl}`);
    const branch = spec.gitRef?.trim() || "main";
    const shaRes = await Result.tryPromise({
      try: () => fetchBranchHeadSha(null, gh.owner, gh.repo, branch),
      catch: (e) => (e instanceof Error ? e.message : String(e)),
    });
    if (shaRes.isErr()) {
      return skip(name, `couldn't resolve ${branch} on ${gh.owner}/${gh.repo}: ${shaRes.error}`);
    }
    const ref = `refs/heads/${branch}`;

    const created = await Result.tryPromise({
      try: () =>
        createComposeRecord({
          projectId,
          name,
          source: "git",
          composeContent: null,
          gitRepoUrl: gh.cloneUrl,
          gitRef: ref,
          composePath: spec.composePath?.trim() || null,
          stackName,
          services: [],
          exposed,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
    if (created.isErr()) {
      return skip(
        name,
        isUniqueViolation(created.error) ? "a resource with that name already exists" : created.error.message,
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
      gitRepoId: project.gitRepoId ?? created.value.resource.id,
      ref,
      sha: shaRes.value,
      deploymentIds: [dep?.id ?? ""],
    });
    log.set({ manifestComposeBuild: { resourceId: created.value.resource.id, ref } });
    return Result.ok({ resourceId: created.value.resource.id as ResourceId });
  }

  // ── Inline source: parse + create the row, then deploy now. ──
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
      isUniqueViolation(created.error) ? "a resource with that name already exists" : created.error.message,
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
