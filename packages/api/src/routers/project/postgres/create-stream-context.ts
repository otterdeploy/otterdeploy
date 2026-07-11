/**
 * Derived-value preparation for the postgres create stream. Computes every
 * value the stages need before any docker work (credentials, public-domain
 * resolution, container/volume names) and builds the early hand-off resource
 * view. Pulled out of the stages so each file stays readable.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { ProjectId } from "@otterdeploy/shared/id";

import {
  knownPostgresExtensions,
  resolvePostgresImage,
} from "@otterdeploy/shared/postgres-extensions";
import { randomBytes } from "node:crypto";

import { PLATFORM } from "../../../constants";
import { loadDomainSourcesForProject } from "../../../lib/domain-sources";
import { resolvePublicDomain } from "../../../lib/domains";
import { getEngineAdapter, type DatabaseEngineAdapter } from "../../../swarm";
import { createDatabaseResourceRecord } from "../queries";
import {
  sanitizeDatabaseName,
  sanitizeDockerName,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";
import { deriveInternalDbCredentials } from "./credentials";

export type CreatedRecord = Awaited<ReturnType<typeof createDatabaseResourceRecord>>;

export interface CreateStreamInput {
  projectId: ProjectId;
  organizationId: string;
  name: string;
  engine?: DatabaseEngine;
  publicEnabled?: boolean;
  password?: string;
  /** Postgres extensions to bake into the create: the image is resolved from
   *  these up-front (pgvector/postgis/timescaledb need a different image), so
   *  a staged create + staged extensions deploy as ONE container — not
   *  create-then-image-swap. Ignored for non-postgres engines. */
  extensions?: string[];
  /** User env vars to bake into the create — staged env + staged create
   *  deploy as ONE container instead of create-then-env-roll. */
  extraEnv?: Record<string, string>;
  project: { id: string; slug: string };
}

export interface CreateContext {
  engine: DatabaseEngine;
  adapter: DatabaseEngineAdapter;
  extensions: string[];
  extraEnv: Record<string, string>;
  publicEnabled: boolean;
  project: { id: string; slug: string };
  resourceSlug: string;
  projectSlug: string;
  password: string;
  databaseName: string;
  username: string;
  internalHostname: string;
  internalConnectionString: string;
  resolved: ReturnType<typeof resolvePublicDomain>;
  publicHostname: string;
  containerName: string;
  volumeName: string;
  publicConnectionString: string;
  dbImage: string;
}

/** Compute every derived value the create stream needs before any docker work:
 *  credentials, public-domain resolution, container/volume names. */
export async function prepareCreateContext(input: CreateStreamInput): Promise<CreateContext> {
  const engine: DatabaseEngine = input.engine ?? "postgres";
  const adapter = getEngineAdapter(engine);
  // Bake extensions into the create so the container starts on the right
  // image immediately. Unknown names are dropped (catalog-validated); an
  // image conflict (e.g. pgvector + timescaledb) falls back to the default —
  // the post-create extensions pass surfaces the conflict as a typed error.
  const extensions =
    engine === "postgres" ? [...new Set(knownPostgresExtensions(input.extensions ?? []))] : [];
  const resolvedImage = resolvePostgresImage(extensions, adapter.defaultImage);
  const dbImage = resolvedImage.ok ? resolvedImage.image : adapter.defaultImage;
  // Caddy layer4 ALPN routing is engine-specific; only postgres has a wired
  // ALPN today. Other engines stay internal-only until we plumb their TCP
  // proxy path (redis raw TCP, mariadb mysql ALPN, etc.).
  const publicEnabled = engine === "postgres" ? (input.publicEnabled ?? false) : false;
  const resourceSlug = sanitizeDatabaseName(input.name);
  const projectSlug = sanitizeProjectSlug(input.project.slug);
  // Reuse the password minted at stage time (so the credentials the operator
  // copied from the pending panel keep working), else generate a fresh one.
  const password = input.password ?? randomBytes(18).toString("base64url");
  // Internal identity is the shared deriver's output — the SAME function the
  // draft-credentials endpoint uses, so pending-panel display and deployed
  // reality can't drift.
  const { databaseName, username, internalHostname, internalConnectionString } =
    deriveInternalDbCredentials({
      engine,
      projectSlug: input.project.slug,
      resourceName: input.name,
      password,
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
    `otterdeploy-${adapter.nameShort}-${projectSlug}-${resourceSlug}`,
  );
  const volumeName = sanitizeDockerName(
    `otterdeploy-${adapter.nameShort}data-${projectSlug}-${resourceSlug}`,
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
// record. We do NOT call mapDatabaseResource here — that would trigger
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
    name: created.resource.name,
    type: "database" as const,
    status: created.resource.status,
    // The create's deployment row is inserted right after this event is
    // emitted — at this instant there is none yet. The synthetic "starting"
    // runtime below keeps the card on "building" until the next list poll
    // picks up the real row.
    latestDeploymentStatus: null,
    latestDeploymentStartedAt: null,
    latestDeploymentFinishedAt: null,
    engine: ctx.engine,
    databaseName: created.database.databaseName,
    username: created.database.username,
    password: created.database.password,
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
      serviceName: ctx.containerName,
      volumeName: ctx.volumeName,
      networkName: `otterdeploy-${ctx.projectSlug}`,
      status: "starting",
      health: "starting",
    },
    extraEnv: created.database.extraEnv ?? {},
    secretKeys: created.database.secretKeys ?? [],
    extensions: created.database.extensions ?? [],
  };
}
