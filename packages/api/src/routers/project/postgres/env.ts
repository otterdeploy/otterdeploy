/**
 * Postgres resource mutators: public-toggle, env-var writers, rollback.
 *
 * All paths through `applyPostgresExtraEnv` are the only way the postgres
 * container env array changes after creation — they insert a deployment
 * row, persist the new env, and roll the swarm task. Direct callers
 * (`setPostgresExtraEnvKey`, `unsetPostgresExtraEnvKey`,
 * `rollbackPostgresToSnapshot`) just build the desired env map.
 */

import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { reconcile } from "../../../caddy";
import { deleteProxyRoutesByResource, insertProxyRoute } from "../../../caddy/queries";
import { loadDomainSourcesForProject } from "../../../lib/domain-sources";
import { resolvePublicDomain } from "../../../lib/domains";
import { syncManifestDatabasePublic } from "../manifest";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import { getDatabaseResourceRecord, getProjectInOrg, setDatabaseResourcePublic } from "../queries";
import { mapDatabaseResource, type PostgresResource } from "../views";

export {
  applyPostgresExtraEnv,
  rollbackPostgresToSnapshot,
  setPostgresExtraEnvKey,
  unsetPostgresExtraEnvKey,
} from "./env-extra";

export async function setPostgresPublic(
  input: ProjectRef & { resourceId: ResourceId; publicEnabled: boolean },
  log: RequestLogger,
): Promise<Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>> {
  log.set({
    resource: { kind: "postgres", projectId: input.projectId, id: input.resourceId },
    setPublic: { requested: input.publicEnabled },
  });

  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  // Drop existing routes either way — on disable we want them gone; on
  // enable we want exactly one fresh route so a stale registration doesn't
  // sneak through. The reconcile below picks up the new state.
  await deleteProxyRoutesByResource(input.resourceId);

  if (input.publicEnabled) {
    // Caddy can only issue a public ACME cert for a domain the operator
    // proved they own — recompute the resolver outcome here so the route
    // carries the right tls flag regardless of when the DB was created.
    const domainSources = (await loadDomainSourcesForProject(input.projectId)) ?? {
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
        resourceSlug: record.resource.name,
        projectSlug: project.slug,
        kind: "database",
      },
      domainSources,
    );
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: input.resourceId,
      type: "layer4",
      domain: record.database.publicHostname,
      upstreamHost: record.database.internalHostname,
      upstreamPort: record.database.internalPort,
      protocol: "tcp",
      layer4Alpn: "postgresql",
      // ACME only for resolver-verified domains; sslip + unverified
      // org/project domains stay on `tls internal`.
      usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
    });
  }

  await setDatabaseResourcePublic(input.resourceId, input.publicEnabled);

  // NO container roll. Public access is purely the layer4 `proxy_route`
  // inserted above (Caddy dials the container over the project network on
  // both runtimes; neither driver host-publishes the engine port), so the
  // container spec is identical either way. Rolling here used to recreate
  // the database for an edge-only change — seconds of downtime plus a
  // "missing" status flash for nothing. Legacy containers that still carry
  // a host binding from the old docker-driver model shed it on their next
  // natural roll (env change / restart / recovery).

  // Keep the saved manifest truthful: if it explicitly declares this
  // database's publicEnabled, patch it to the applied value. Otherwise the
  // next `manifest.diff` poll sees manifest≠row and stages a phantom update
  // that REVERTS this toggle on Apply.
  await syncManifestDatabasePublic(
    { projectId: input.projectId, organizationId: input.organizationId },
    record.resource.name,
    input.publicEnabled,
  );

  await reconcile(log);

  return Result.ok(
    await mapDatabaseResource(
      {
        resource: record.resource,
        database: { ...record.database, publicEnabled: input.publicEnabled },
      },
      project.slug,
    ),
  );
}
