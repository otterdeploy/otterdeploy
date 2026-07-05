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

import { resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";
import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { reconcile } from "../../../caddy";
import { deleteProxyRoutesByResource, insertProxyRoute } from "../../../caddy/queries";
import { loadDomainSourcesForProject } from "../../../lib/domain-sources";
import { resolvePublicDomain } from "../../../lib/domains";
import { updateSwarmDatabase } from "../../../runtime/db";
import { defaultImageFor } from "../../../swarm";
import { insertDeployment, markDeploymentFailed, reconcileDeploySuccess } from "../deployments";
import { syncManifestDatabasePublic } from "../manifest";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import { getDatabaseResourceRecord, getProjectInOrg, setDatabaseResourcePublic } from "../queries";
import {
  buildContainerName,
  buildVolumeName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";
import { snapshotForPostgresCreate } from "./snapshot";

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

  // Re-roll the swarm spec. The DB is never host-published (no raw 5432 on the
  // node) — public access is the layer4 `proxy_route` inserted above, served by
  // Caddy on :443. The redeploy just keeps the running spec in sync; app
  // containers in the same project always reach the DB via the overlay alias.
  const engine = record.database.engine;
  // Preserve the extension-resolved image — a bare `defaultImageFor` here
  // would silently downgrade a pgvector/postgis/timescale container on every
  // public toggle.
  const resolvedImage = resolvePostgresImage(
    record.database.extensions ?? [],
    defaultImageFor(engine),
  );
  const engineImage = resolvedImage.ok ? resolvedImage.image : defaultImageFor(engine);
  const publicDeployment = await insertDeployment({
    resourceId: input.resourceId,
    image: engineImage,
    reason: "redeploy",
    snapshot: snapshotForPostgresCreate({
      image: engineImage,
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      publicEnabled: input.publicEnabled,
      publicHostname: record.database.publicHostname,
      internalHostname: record.database.internalHostname,
      extraEnv: record.database.extraEnv ?? {},
    }),
  });
  let rolled: Awaited<ReturnType<typeof updateSwarmDatabase>>;
  try {
    rolled = await updateSwarmDatabase(
      {
        engine,
        image: engineImage,
        serviceName: buildContainerName({
          engine,
          projectSlug: project.slug,
          resourceName: record.resource.name,
        }),
        volumeName: buildVolumeName({
          engine,
          projectSlug: project.slug,
          resourceName: record.resource.name,
        }),
        hostnameAlias: record.database.internalHostname,
        databaseName: record.database.databaseName,
        username: record.database.username,
        password: record.database.password,
        projectSlug: sanitizeProjectSlug(project.slug),
        resourceId: input.resourceId,
        deploymentId: publicDeployment.id,
        extraEnv: record.database.extraEnv ?? {},
        public: input.publicEnabled,
      },
      log,
    );
  } catch (err) {
    await markDeploymentFailed(
      publicDeployment.id,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
  // The driver waited for the rolled container — flip the deployment row to
  // running now so every status surface agrees without waiting for a poll.
  if (rolled.status === "running") {
    await reconcileDeploySuccess([publicDeployment.id], input.resourceId);
  }

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
