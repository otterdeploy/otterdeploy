/**
 * Generic resource READ orchestration + the new-resource wizard's live probes
 * (name availability, public-host preview). Engine-specific create lives in
 * postgres.ts (and future siblings); the destructive `deleteProjectResource`
 * saga lives in ./resource-delete.ts and is re-exported below so call sites
 * keep importing it from here.
 */

import type { EnvironmentId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import type { ProjectRef, ResourceRef } from "../scopes";

import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { resolvePublicDomain, type ResolvedDomain } from "../../lib/domains";
import { listServiceEnvVarsForResources } from "../service/queries";
import { sanitizeSlug } from "../service/views";
import { getLatestDeploymentsForResources } from "./deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import {
  getProjectInOrg,
  getResourceById,
  listProjectResources as listProjectResourcesQuery,
  resolveEnvironmentScope,
} from "./queries";
import {
  mapComposeResource,
  mapDatabaseResource,
  mapServiceResource,
  sanitizeProjectSlug,
  type ProjectResource,
} from "./views";

export type { ProjectResource };
export { deleteProjectResource } from "./resource-delete";

/**
 * Live name-availability check for the new-resource wizard. Returns
 * `{ available: true, suggestion: null }` when the name is free, or
 * `{ available: false, suggestion: "<base>-N" }` with the lowest free
 * suffix when taken. Names are unique per `(projectId, environmentId, name)`
 * via `resource_project_name_env_unique`, so the check MUST be scoped to the
 * same environment the create will land in, or `api` in staging reads as taken
 * because production has one.
 */
export async function checkResourceName(
  input: ProjectRef & { name: string; environmentId?: EnvironmentId },
): Promise<Result<{ available: boolean; suggestion: string | null }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const scope = resolveEnvironmentScope(project, input.environmentId);
  const { databases, services } = scope
    ? await listProjectResourcesQuery(input.projectId, scope)
    : { databases: [], services: [] };
  const used = new Set<string>();
  for (const row of databases) used.add(row.resource.name);
  for (const row of services) used.add(row.resource.name);

  const requested = input.name.trim();
  if (!used.has(requested)) {
    return Result.ok({ available: true, suggestion: null });
  }

  // Suffix `-N` until we find a free one. Bounded loop. Projects with
  // 1000+ same-base names are extraordinary; cap at 1000 to keep this
  // cheap and predictable.
  for (let i = 2; i <= 1000; i++) {
    const candidate = `${requested}-${i}`;
    if (!used.has(candidate)) {
      return Result.ok({ available: false, suggestion: candidate });
    }
  }
  return Result.ok({ available: false, suggestion: null });
}

/**
 * Read-only preview of the public FQDN a service named `name` would publish
 * at: the same resolver chain `exposeService` walks (project custom domain
 * → org base → local dev base → sslip fallback; no per-resource override
 * exists yet for a service that isn't created). Lets the new-resource wizard
 * show and stage the real hostname instead of guessing client-side.
 */
export async function previewResourcePublicHost(
  input: ProjectRef & { name: string },
): Promise<Result<{ fqdn: string; source: ResolvedDomain["source"] }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }
  const sources = (await loadDomainSourcesForProject(input.projectId)) ?? {
    resourceOverride: null,
    projectCustomDomain: null,
    projectCustomDomainVerifiedAt: null,
    orgBaseDomain: null,
    orgBaseDomainVerifiedAt: null,
    localBaseDomain: null,
    serverIp: null,
  };
  const resolved = resolvePublicDomain(
    {
      resourceSlug: sanitizeSlug(input.name),
      projectSlug: sanitizeProjectSlug(project.slug),
      kind: "service",
    },
    sources,
  );
  return Result.ok({ fqdn: resolved.fqdn, source: resolved.source });
}

export async function listProjectResources(
  input: ProjectRef & { environmentId?: EnvironmentId },
): Promise<Result<ProjectResource[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // No environment pointer at all means the project predates environments and
  // has nothing scoped to read, an empty list, not every row in the project.
  const scope = resolveEnvironmentScope(project, input.environmentId);
  if (!scope) return Result.ok([]);

  const { databases, services, composes } = await listProjectResourcesQuery(input.projectId, scope);

  // Batch the per-resource reads the mappers would otherwise fire one-by-one:
  // the latest deployment for every service/compose, and env vars for every
  // service: two queries total instead of ~2 per resource on every list load.
  const deploymentResourceIds = [
    ...services.map((r) => r.resource.id),
    ...composes.map((r) => r.resource.id),
  ] as ResourceId[];
  const serviceResourceIds = services.map((r) => r.resource.id) as ResourceId[];
  const [latestByResource, envByResource] = await Promise.all([
    getLatestDeploymentsForResources(deploymentResourceIds),
    listServiceEnvVarsForResources(serviceResourceIds),
  ]);

  const [databaseViews, serviceViews, composeViews] = await Promise.all([
    // Databases still resolve their live runtime individually via the
    // self-healing recovery path (ensureSwarmRuntimeForRecord): left as-is.
    Promise.all(databases.map((record) => mapDatabaseResource(record, project.slug))),
    Promise.all(
      services.map((record) =>
        mapServiceResource(record, {
          latest: latestByResource.get(record.resource.id as ResourceId) ?? null,
          envRows: envByResource.get(record.resource.id as ResourceId) ?? [],
        }),
      ),
    ),
    Promise.all(
      composes.map((record) =>
        mapComposeResource(record, {
          latest: latestByResource.get(record.resource.id as ResourceId) ?? null,
        }),
      ),
    ),
  ]);

  const rows = [...databaseViews, ...serviceViews, ...composeViews];
  return Result.ok(rows);
}

export async function getProjectResource(
  input: ResourceRef,
): Promise<Result<ProjectResource, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  switch (found.kind) {
    case "database":
      return Result.ok(await mapDatabaseResource(found.record, project.slug));
    case "service":
      return Result.ok(await mapServiceResource(found.record));
    default:
      // Stacks aren't served by the generic resource view. The compose
      // router (compose.get) owns their read model. Also the exhaustive
      // fallback: tsc can't prove the switch covers `found.kind`, so a
      // bare case list reads as "lacks ending return statement".
      return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
}
