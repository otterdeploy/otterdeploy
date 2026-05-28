/**
 * One-stop loader for the rows the pipeline needs.
 *
 * The build pipeline starts from a single `deploymentId` and needs a
 * web of related rows: the resource, the project (for build config +
 * registry choice + git binding), the registry credentials, and the
 * git repo (for clone URL + installation id). Loading them all up
 * front means the pipeline can fail fast with a clear error if any
 * piece is missing, rather than crashing partway through a `nixpacks
 * build`.
 *
 * Returns `null` for any row that's not found so callers can decide
 * whether the absence is fatal (no project = fatal) or graceful (no
 * registry = "project not built-pipeline-configured, skip").
 */

import { db } from "@otterdeploy/db";
import {
  containerRegistry,
  deployment,
  gitRepo,
  project,
  resource,
} from "@otterdeploy/db/schema";
import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";

type DeploymentId = Id<typeof ID_PREFIX.deployment>;

export interface PipelineContext {
  deployment: typeof deployment.$inferSelect;
  resource: typeof resource.$inferSelect;
  project: typeof project.$inferSelect;
  registry: typeof containerRegistry.$inferSelect;
  repo: typeof gitRepo.$inferSelect;
}

export class PipelineLoadError extends Error {
  constructor(public readonly step: string, message: string) {
    super(`pipeline-load: ${step}: ${message}`);
  }
}

export async function loadPipelineContext(
  deploymentId: DeploymentId,
): Promise<PipelineContext> {
  const [dep] = await db
    .select()
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .limit(1);
  if (!dep) throw new PipelineLoadError("deployment", `${deploymentId} not found`);

  const [res] = await db
    .select()
    .from(resource)
    .where(eq(resource.id, dep.resourceId))
    .limit(1);
  if (!res) throw new PipelineLoadError("resource", `${dep.resourceId} not found`);
  if (res.type !== "service") {
    throw new PipelineLoadError(
      "resource.type",
      `resource ${res.id} is type=${res.type}; only services are built`,
    );
  }

  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, res.projectId))
    .limit(1);
  if (!proj) throw new PipelineLoadError("project", `${res.projectId} not found`);

  if (!proj.gitRepoId) {
    throw new PipelineLoadError(
      "project.gitRepoId",
      `project ${proj.id} has no git repo binding`,
    );
  }
  if (!proj.imageRepository) {
    throw new PipelineLoadError(
      "project.imageRepository",
      `project ${proj.id} has no imageRepository configured`,
    );
  }
  if (!proj.containerRegistryId) {
    throw new PipelineLoadError(
      "project.containerRegistryId",
      `project ${proj.id} has no registry credentials configured`,
    );
  }

  const [reg] = await db
    .select()
    .from(containerRegistry)
    .where(eq(containerRegistry.id, proj.containerRegistryId))
    .limit(1);
  if (!reg) {
    throw new PipelineLoadError(
      "registry",
      `container_registry ${proj.containerRegistryId} not found`,
    );
  }

  const [repo] = await db
    .select()
    .from(gitRepo)
    .where(eq(gitRepo.id, proj.gitRepoId))
    .limit(1);
  if (!repo) {
    throw new PipelineLoadError("repo", `git_repo ${proj.gitRepoId} not found`);
  }
  if (!repo.installationId) {
    throw new PipelineLoadError(
      "repo.installationId",
      `git_repo ${repo.id} is not linked to an installation (revoked?)`,
    );
  }

  return {
    deployment: dep,
    resource: res,
    project: proj,
    registry: reg,
    repo,
  };
}
