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
 * The registry is optional: when the project binds an external one we
 * load its credentials (the build pushes there for remote/multi-node
 * swarms); with no binding we resolve a registry-less local image name
 * and the build stays on the host daemon — see `runBuildPipeline`.
 */

import type { DeploymentId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  containerRegistry,
  deployment,
  gitRepo,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema";
import { eq } from "drizzle-orm";

export interface PipelineContext {
  deployment: typeof deployment.$inferSelect;
  resource: typeof resource.$inferSelect;
  /** The service row for this resource — carries `buildConfig`, which
   *  tells the pipeline which builder to dispatch to (and its options). */
  service: typeof serviceResource.$inferSelect;
  project: typeof project.$inferSelect;
  /** External registry row when the project binds one; `null` for the
   *  default local-build path (image stays in the host daemon). */
  registry: typeof containerRegistry.$inferSelect | null;
  /** Resolved image repository, no tag. `<host>/<path>` when an external
   *  registry is bound, else a registry-less local name the build `--load`s
   *  into the host daemon and swarm runs directly. */
  imageRepository: string;
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

  const [svc] = await db
    .select()
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, res.id))
    .limit(1);
  if (!svc) {
    throw new PipelineLoadError("service", `service_resource for ${res.id} not found`);
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

  // Registry is optional. A project that binds one (containerRegistryId +
  // imageRepository) pushes there so a remote/multi-node swarm can pull the
  // image. With no binding we build a registry-less local image: the builder
  // shares the host docker socket with the single-node swarm, so the
  // `--load`ed image is already present where the container runs — no push.
  let registry: typeof containerRegistry.$inferSelect | null = null;
  let imageRepository: string;
  if (proj.containerRegistryId && proj.imageRepository) {
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
    registry = reg;
    imageRepository = proj.imageRepository;
  } else {
    imageRepository = localImageRepository(svc.serviceName);
  }

  const [repo] = await db
    .select()
    .from(gitRepo)
    .where(eq(gitRepo.id, proj.gitRepoId))
    .limit(1);
  if (!repo) {
    throw new PipelineLoadError("repo", `git_repo ${proj.gitRepoId} not found`);
  }
  // installationId is allowed to be null for public-URL bindings — the
  // pipeline clones anonymously in that case. Only error here when the
  // row was originally linked to an installation that's now revoked
  // (no way to distinguish today; deferred until we add a `kind` col).

  return {
    deployment: dep,
    resource: res,
    service: svc,
    project: proj,
    registry,
    imageRepository,
    repo,
  };
}

/** Registry-less local image name for the default build path. Namespaced
 *  and lowercased so it never collides with a public docker.io repo; swarm
 *  on the same node runs it straight from the daemon's local store. */
function localImageRepository(serviceName: string): string {
  return `otterstack-local/${serviceName.toLowerCase()}`;
}
