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
  gitInstallation,
  gitRepo,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema";
import { TaggedError } from "better-result";
import { and, eq } from "drizzle-orm";

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
  /** GitHub-side numeric installation id used to mint clone tokens, resolved
   *  from `repo.installationId` (an internal `git_installation.id` FK — NOT
   *  the value GitHub's token API wants). Only resolved for *private* repos
   *  (public repos clone anonymously and never mint a token); `null` for
   *  public bindings or when no installation is needed. Mirrors the resolution
   *  in `manifest-apply-git.ts`. */
  githubInstallationId: string | null;
}

export class PipelineLoadError extends TaggedError("PipelineLoadError")<{
  step: string;
  message: string;
}>() {
  constructor(step: string, reason: string) {
    super({ step, message: `pipeline-load: ${step}: ${reason}` });
  }
}

export async function loadPipelineContext(deploymentId: DeploymentId): Promise<PipelineContext> {
  const [dep] = await db.select().from(deployment).where(eq(deployment.id, deploymentId)).limit(1);
  if (!dep) throw new PipelineLoadError("deployment", `${deploymentId} not found`);

  const [res] = await db.select().from(resource).where(eq(resource.id, dep.resourceId)).limit(1);
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

  const [proj] = await db.select().from(project).where(eq(project.id, res.projectId)).limit(1);
  if (!proj) throw new PipelineLoadError("project", `${res.projectId} not found`);

  // Git binding now lives on the SERVICE, not the project — two services in one
  // project can build from two different repos. Fail fast if this one isn't
  // bound (the operator picks a repo in the service's Source settings).
  if (!svc.gitRepoId) {
    throw new PipelineLoadError(
      "service.gitRepoId",
      `service ${res.name} has no git repo binding — pick a repo in its Source settings`,
    );
  }

  // Registry is optional. When the service sets an imageRepository, the builder
  // pushes there (so a remote/multi-node swarm can pull) and the push credential
  // is matched from the shared registry library by the image's host. With no
  // imageRepository we build a registry-less local image: the builder shares the
  // host docker socket with the single-node swarm, so the `--load`ed image is
  // already present where the container runs — no push. This is the default.
  let registry: typeof containerRegistry.$inferSelect | null = null;
  let imageRepository: string;
  if (svc.imageRepository) {
    const host = svc.imageRepository.split("/")[0] ?? "";
    const [reg] = await db
      .select()
      .from(containerRegistry)
      .where(
        and(
          eq(containerRegistry.host, host),
          eq(containerRegistry.organizationId, proj.organizationId),
        ),
      )
      .limit(1);
    if (!reg) {
      throw new PipelineLoadError(
        "registry",
        `no registry credential for host ${host} — add one in Registries or clear the image target`,
      );
    }
    registry = reg;
    imageRepository = svc.imageRepository;
  } else {
    imageRepository = localImageRepository(svc.serviceName);
  }

  const [repo] = await db.select().from(gitRepo).where(eq(gitRepo.id, svc.gitRepoId)).limit(1);
  if (!repo) {
    throw new PipelineLoadError("repo", `git_repo ${svc.gitRepoId} not found`);
  }
  // Only a *private* repo actually needs a clone token — a public repo clones
  // fine over anonymous HTTPS. repo.installationId is an internal
  // `git_installation.id` FK; the token mint + GitHub API want the *numeric*
  // installation id, so resolve the row here (handing the internal id to
  // getInstallationToken fails with "no installation row for gitinst_…").
  //
  // Resolving is gated on isPrivate so a PUBLIC repo that was bound through the
  // GitHub App and later lost its installation (app removed / reconnected,
  // which orphans the FK) still builds — it doesn't need the token at all.
  // Only a private repo hard-fails, with a reconnect hint. Same lookup as
  // manifest-apply-git.ts.
  let githubInstallationId: string | null = null;
  if (repo.installationId && repo.isPrivate) {
    const [inst] = await db
      .select({ installationId: gitInstallation.installationId })
      .from(gitInstallation)
      .where(eq(gitInstallation.id, repo.installationId))
      .limit(1);
    if (!inst) {
      throw new PipelineLoadError(
        "installation",
        `git_installation ${repo.installationId} not found — reconnect GitHub in Settings → Git Providers`,
      );
    }
    githubInstallationId = inst.installationId;
  }

  return {
    deployment: dep,
    resource: res,
    service: svc,
    project: proj,
    registry,
    imageRepository,
    repo,
    githubInstallationId,
  };
}

/** Registry-less local image name for the default build path. Namespaced
 *  and lowercased so it never collides with a public docker.io repo; swarm
 *  on the same node runs it straight from the daemon's local store. */
function localImageRepository(serviceName: string): string {
  return `otterdeploy-local/${serviceName.toLowerCase()}`;
}
