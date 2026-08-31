/**
 * Derived-value preparation for the postgres create stream. Computes every
 * value the stages need before any docker work (credentials, public-domain
 * resolution, container/volume names) and builds the early hand-off resource
 * view. Pulled out of the stages so each file stays readable.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { DATABASE_ENGINES, type DatabaseEngine } from "@otterdeploy/shared/database-engines";
import {
  knownPostgresExtensions,
  resolvePostgresImage,
} from "@otterdeploy/shared/postgres-extensions";
import { randomBytes } from "node:crypto";

import type { HostRow } from "../../../database-hosting";

import { PLATFORM } from "../../../constants";
import { loadDomainSourcesForProject } from "../../../lib/domain-sources";
import { resolvePublicDomain } from "../../../lib/domains";
import { resolveRuntimeScope } from "../../../lib/environment/runtime-scope";
import { scopeSuffix } from "../../../lib/environment/scoping";
import { getEngineAdapter, type DatabaseEngineAdapter } from "../../../swarm";
import { createDatabaseResourceRecord } from "../queries";
import {
  sanitizeDatabaseName,
  sanitizeDockerName,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";
import { deriveInternalDbCredentials } from "./credentials";
import { hostContainerName, hostVolumeName } from "./hosted-names";

export type CreatedRecord = Awaited<ReturnType<typeof createDatabaseResourceRecord>>;

export interface CreateStreamInput {
  projectId: ProjectId;
  organizationId: string;
  name: string;
  engine?: DatabaseEngine;
  /** Image tag the operator picked in the wizard / declared in the manifest
   *  (e.g. "18", "17-alpine"). Omitted → the engine's catalog default tag. */
  version?: string;
  publicEnabled?: boolean;
  password?: string;
  /** Postgres extensions to bake into the create: the image is resolved from
   *  these up-front (pgvector/postgis/timescaledb need a different image), so
   *  a staged create + staged extensions deploy as ONE container, not
   *  create-then-image-swap. Ignored for non-postgres engines. */
  extensions?: string[];
  /** User env vars to bake into the create. Staged env + staged create
   *  deploy as ONE container instead of create-then-env-roll. */
  extraEnv?: Record<string, string>;
  /** Put this database INSIDE an existing server rather than giving it a
   *  container of its own. Resolved and validated by the caller
   *  (`resolveHostForTenant`) so the context builder can trust it. */
  host?: HostRow | null;
  /** Cap on the tenant's concurrent connections. Only meaningful with `host`:
   *  a dedicated server's connections are already its own. */
  connectionLimit?: number | null;
  /** Environment the database is created in. Drives the runtime scope: a
   *  non-main environment gets a suffix on its hostname, container and volume
   *  so a staging `postgres` stops colliding with production's (od-jwx). */
  environmentId?: EnvironmentId | null;
  project: { id: ProjectId; slug: string };
}

export interface CreateContext {
  engine: DatabaseEngine;
  /** The server this database lives inside, or null when it gets its own
   *  container. Set → the create skips the image pull, the swarm provision,
   *  the boot-log tail and the volume entirely. */
  host: HostRow | null;
  hostResourceId: ResourceId | null;
  connectionLimit: number | null;
  adapter: DatabaseEngineAdapter;
  extensions: string[];
  extraEnv: Record<string, string>;
  publicEnabled: boolean;
  project: { id: ProjectId; slug: string };
  resourceSlug: string;
  projectSlug: string;
  password: string;
  databaseName: string;
  username: string;
  internalHostname: string;
  internalPort: number;
  internalConnectionString: string;
  resolved: ReturnType<typeof resolvePublicDomain>;
  publicHostname: string;
  containerName: string;
  volumeName: string;
  publicConnectionString: string;
  dbImage: string;
}

/**
 * The image the container will run and the extension set baked into it.
 *
 * Extensions decide the image (pgvector / PostGIS / TimescaleDB each pin their
 * own), so they resolve together: doing it up-front is what makes a staged
 * create + staged extensions deploy as ONE container instead of a create
 * followed by an image-swap redeploy.
 */
function resolveImageAndExtensions(
  input: CreateStreamInput,
  engine: DatabaseEngine,
  adapter: DatabaseEngineAdapter,
): { extensions: string[]; dbImage: string } {
  // Unknown names are dropped (catalog-validated); an image conflict
  // (e.g. pgvector + timescaledb) falls back to the default, and the
  // post-create extensions pass surfaces it as a typed error.
  const extensions =
    engine === "postgres" ? [...new Set(knownPostgresExtensions(input.extensions ?? []))] : [];
  // Honour the operator's version pick (manifest `version` / wizard tag): it
  // becomes the base `<repo>:<tag>` the extension resolver refines. Omitted →
  // the catalog default.
  const baseImage = input.version
    ? `${DATABASE_ENGINES[engine].dockerImage}:${input.version}`
    : adapter.defaultImage;
  const resolved = resolvePostgresImage(extensions, baseImage);
  return { extensions, dbImage: resolved.ok ? resolved.image : baseImage };
}

/** Compute every derived value the create stream needs before any docker work:
 *  credentials, public-domain resolution, container/volume names. */
export async function prepareCreateContext(input: CreateStreamInput): Promise<CreateContext> {
  const engine: DatabaseEngine = input.engine ?? "postgres";
  const adapter = getEngineAdapter(engine);
  const host = input.host ?? null;
  const { extensions, dbImage } = resolveImageAndExtensions(input, engine, adapter);
  // Caddy layer4 ALPN routing is engine-specific; only postgres has a wired
  // ALPN today. Other engines stay internal-only until we plumb their TCP
  // proxy path (redis raw TCP, mariadb mysql ALPN, etc.).
  // Public exposure is per-CONTAINER: the layer4 route SNI-routes a hostname
  // to one upstream, and every tenant on a server shares that upstream, so a
  // route for one would answer for its neighbours' credentials too. Tenants
  // are internal-only until the proxy can route by database, and the create
  // path forces it rather than accepting a flag it would silently ignore.
  const publicEnabled = engine === "postgres" && !host ? (input.publicEnabled ?? false) : false;
  const resourceSlug = sanitizeDatabaseName(input.name);
  const projectSlug = sanitizeProjectSlug(input.project.slug);
  // Reuse the password minted at stage time (so the credentials the operator
  // copied from the pending panel keep working), else generate a fresh one.
  const password = input.password ?? randomBytes(18).toString("base64url");
  // Internal identity is the shared deriver's output. The SAME function the
  // draft-credentials endpoint uses, so pending-panel display and deployed
  // reality can't drift.
  // BASE for main and for unstamped rows, so nothing already deployed is
  // renamed; only a non-main environment takes a suffix. See
  // lib/environment/runtime-scope.
  const suffix = scopeSuffix(
    await resolveRuntimeScope({
      projectId: input.project.id,
      environmentId: input.environmentId ?? null,
    }),
  );
  const { databaseName, username, internalHostname, internalPort, internalConnectionString } =
    deriveInternalDbCredentials({
      scopeSuffix: suffix,
      engine,
      projectSlug: input.project.slug,
      resourceName: input.name,
      password,
      // A tenant answers on its host's address. Its database name and user
      // stay its own, so the credentials the operator sees are the tenant's.
      host: host
        ? { internalHostname: host.internalHostname, internalPort: host.internalPort }
        : null,
    });
  // Walk the org/project/sslip chain to pick the public hostname. The org and
  // project rows may not exist yet for the first project, so a null sources
  // record falls back to sslip via the resolver's defaults.
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
    { resourceSlug, projectSlug, kind: "database" },
    domainSources,
  );
  // Container + volume names use the engine's short slug so multi-engine
  // deployments don't collide on a shared name pattern.
  const containerName = sanitizeDockerName(
    `otterdeploy-${adapter.nameShort}-${projectSlug}-${resourceSlug}${suffix}`,
  );
  const volumeName = sanitizeDockerName(
    `otterdeploy-${adapter.nameShort}data-${projectSlug}-${resourceSlug}${suffix}`,
  );
  // Public Postgres is reached on :443 (caddy-l4 listener wrapper SNI-routes it
  // next to HTTP), so the port is explicit and non-default. `sslnegotiation:
  // direct` is what makes the SNI routing work.
  const publicConnectionString = adapter.buildConnectionString({
    username,
    password,
    host: resolved.fqdn,
    port: PLATFORM.database.publicPort,
    databaseName,
    sslmode: "require",
    sslnegotiation: "direct",
  });
  return {
    engine,
    host,
    hostResourceId: host?.resourceId ?? null,
    connectionLimit: input.connectionLimit ?? null,
    adapter,
    extensions,
    extraEnv: input.extraEnv ?? {},
    publicEnabled,
    project: input.project,
    resourceSlug,
    projectSlug,
    password,
    databaseName,
    username,
    internalHostname,
    internalPort,
    internalConnectionString,
    resolved,
    publicHostname: resolved.fqdn,
    containerName,
    volumeName,
    publicConnectionString,
    dbImage,
  };
}

// Build the early hand-off PostgresResource view inline from the just-inserted
// record. We do NOT call mapDatabaseResource here. That would trigger
// ensureSwarmRuntimeForRecord, which re-provisions synchronously when it sees
// no runtime yet (we haven't created it). The "starting" placeholder is honest
// about the state; the resource page renders a spinner until the container is up.
export function buildCreatedResourceView(
  created: CreatedRecord,
  ctx: CreateContext,
): PostgresResource {
  const { adapter } = ctx;
  return {
    resourceId: created.resource.id,
    projectId: created.resource.projectId,
    environmentId: created.resource.environmentId,
    name: created.resource.name,
    type: "database" as const,
    status: created.resource.status,
    placementServerId: created.resource.placementServerId ?? null,
    // The create's deployment row is inserted right after this event is
    // emitted. At this instant there is none yet. The synthetic "starting"
    // runtime below keeps the card on "building" until the next list poll
    // picks up the real row.
    latestDeploymentStatus: null,
    latestDeploymentStartedAt: null,
    latestDeploymentFinishedAt: null,
    engine: ctx.engine,
    databaseName: created.database.databaseName,
    username: created.database.username,
    password: created.database.password,
    hostResourceId: created.database.hostResourceId,
    hostName: ctx.host?.name ?? null,
    connectionLimit: created.database.connectionLimit,
    publicEnabled: created.database.publicEnabled,
    publicHostname: created.database.publicHostname,
    publicPort: created.database.publicPort,
    publicConnectionString: created.database.publicConnectionString,
    internalHostname: created.database.internalHostname,
    internalPort: created.database.internalPort,
    internalConnectionString: created.database.internalConnectionString,
    localConnectionString: adapter.buildConnectionString({
      username: created.database.username,
      password: created.database.password,
      host: PLATFORM.database.localHost,
      port: adapter.port,
      databaseName: created.database.databaseName,
      sslmode: "require",
      sslnegotiation: "direct",
    }),
    upstreamHost: created.database.upstreamHost,
    upstreamPort: created.database.upstreamPort,
    runtime: {
      serviceId: null,
      // A tenant has no container or volume of its own: the honest answer for
      // both is its host's, which is what every runtime read resolves to once
      // the row is persisted (see ensureSwarmRuntimeForRecord).
      serviceName: ctx.host ? hostContainerName(ctx.host) : ctx.containerName,
      volumeName: ctx.host ? hostVolumeName(ctx.host) : ctx.volumeName,
      networkName: `otterdeploy-${ctx.projectSlug}`,
      status: "starting",
      health: "starting",
    },
    extraEnv: created.database.extraEnv ?? {},
    secretKeys: created.database.secretKeys ?? [],
    extensions: created.database.extensions ?? [],
  };
}
