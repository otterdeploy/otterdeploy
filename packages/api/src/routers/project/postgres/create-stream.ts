/**
 * Postgres database-resource orchestration. Owns the create lifecycle for a
 * Postgres resource attached to a project — including the Swarm provision and
 * Caddy proxy-route bookkeeping. Read/delete are handled generically in
 * resources.ts.
 */

import { randomBytes } from "node:crypto";

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { reconcile } from "../../../caddy";
import { insertProxyRoute } from "../../../caddy/queries";
import { PLATFORM } from "../../../constants";
import { Docker } from "@otterdeploy/docker";

import {
  getEngineAdapter,
  provisionSwarmDatabase,
  resolveRegistryAuth,
  streamImagePull,
} from "../../../swarm";
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import { loadDomainSourcesForProject } from "../../../lib/domain-sources";
import { resolvePublicDomain } from "../../../lib/domains";
import { insertDeployment, markDeploymentFailed } from "../deployments";

import { PostgresResourceConflictError, ProjectNotFoundError } from "../errors";

import {
  createDatabaseResourceRecord,
  getDatabaseResourceByProjectAndName,
  getProjectInOrg,
  updateDatabaseResourceStatus,
} from "../queries";
import { tailContainerBootLogs } from "./boot-logs";
import { snapshotForPostgresCreate } from "./snapshot";
import type { ProjectRef } from "../../scopes";
import {
  clampPostgresIdentifier,
  isUniqueViolation,
  mapDatabaseResource,
  sanitizeDatabaseName,
  sanitizeDockerName,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";

/**
 * One progress event yielded by the postgres create stream. Mirrors the
 * `createPostgresProgressSchema` in the contract.
 */
export type CreatePostgresProgress =
  | {
      type: "step";
      step: string;
      status: "start" | "ok" | "tick" | "error";
      message: string | null;
    }
  | {
      type: "pull";
      image: string;
      id: string | null;
      status: string;
      progress: string | null;
      current: number | null;
      total: number | null;
    }
  | { type: "log"; stream: "stdout" | "stderr"; line: string }
  | { type: "created"; resource: PostgresResource }
  | { type: "done"; resource: PostgresResource }
  | { type: "error"; code: string; message: string };

/**
 * Pre-flight validation for the create stream. Runs the synchronous checks
 * (project ownership + name conflict) BEFORE any provisioning begins, so
 * the router can throw the right oRPC error before the stream opens. After
 * this returns ok, the generator can safely start yielding step events.
 */
export async function validatePostgresCreate(
  input: ProjectRef & { name: string },
): Promise<
  Result<
    { project: { id: string; slug: string } },
    ProjectNotFoundError | PostgresResourceConflictError
  >
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const existing = await getDatabaseResourceByProjectAndName(
    input.projectId,
    input.name,
  );
  if (existing) {
    return Result.err(new PostgresResourceConflictError({ name: input.name }));
  }

  return Result.ok({ project: { id: project.id, slug: project.slug } });
}

/**
 * Streaming postgres create. Pre-flight failures (missing project, name
 * conflict) are validated separately by validatePostgresCreate() so the
 * router can throw the right oRPC error before the stream opens. Once
 * the stream is open, runtime failures surface as `error` events instead
 * of throws so the wizard can render partial progress.
 *
 * provisionSwarmPostgres already emits log.info() events per step, so
 * the operator sees per-step progress in apps/server terminal output AND
 * the wizard renders a checklist. Same source, two consumers.
 */
export async function* createPostgresResourceStream(
  input: ProjectRef & {
    name: string;
    /** Database engine to provision. Default is postgres for back-compat
     *  with callers that haven't plumbed the param through yet. */
    engine?: DatabaseEngine;
    publicEnabled?: boolean;
    /** Output of validatePostgresCreate so we don't re-fetch the project. */
    project: { id: string; slug: string };
  },
  log: RequestLogger,
): AsyncGenerator<CreatePostgresProgress, void, void> {
  const engine: DatabaseEngine = input.engine ?? "postgres";
  const adapter = getEngineAdapter(engine);
  // Caddy layer4 ALPN routing is engine-specific; only postgres has a
  // wired ALPN today. Other engines stay internal-only until we plumb
  // their TCP proxy path (redis raw TCP, mariadb mysql ALPN, etc.).
  const publicEnabled =
    engine === "postgres" ? (input.publicEnabled ?? false) : false;
  // Note: log.set() calls inside this generator's body are no-ops —
  // hono/evlog flushes the wide event when the response starts streaming,
  // which is BEFORE the first .next() on this generator. The handler sets
  // the audit-relevant fields eagerly before returning the iterator.
  const project = input.project;
  const resourceSlug = sanitizeDatabaseName(input.name);
  const projectSlug = sanitizeProjectSlug(project.slug);
  const databaseName = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_db`);
  const username = clampPostgresIdentifier(`${projectSlug}_${resourceSlug}_user`);
  const password = randomBytes(18).toString("base64url");
  // Walk the org/project/sslip chain to pick the public hostname. The
  // org and project rows may not exist yet for the first project (the
  // create flow above only validated the project exists), so a null
  // sources record falls back to sslip via the resolver's defaults.
  const domainSources = (await loadDomainSourcesForProject(
    input.projectId,
  )) ?? {
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
  const publicHostname = resolved.fqdn;
  // Container + volume names use the engine's short slug (`pg` / `redis`
  // / `mariadb` / `mongo`) so multi-engine deployments don't collide on
  // a shared name pattern.
  const containerName = sanitizeDockerName(
    `otterdeploy-${adapter.nameShort}-${projectSlug}-${resourceSlug}`,
  );
  const volumeName = sanitizeDockerName(
    `otterdeploy-${adapter.nameShort}data-${projectSlug}-${resourceSlug}`,
  );
  const internalHostname = `${resourceSlug}.${projectSlug}.${PLATFORM.database.internalBaseDomain}`;

  // ── Persist the resource row (FIRST) ─────────────────────────────────
  // We insert the row as `draft` before any docker work so the wizard can
  // hand off to the resource page within milliseconds — image pulls,
  // provisioning, and caddy reconcile all keep streaming in the
  // background. If subsequent steps fail, the user sees a draft row they
  // can retry or delete; the alternative (waiting 30s+ to insert) makes
  // the wizard feel hung.
  yield { type: "step", step: "db-record", status: "start", message: null };

  // Public URL has no port. Caddy's layer4 listener for this engine sits on
  // the engine's standard port (5432 postgres, 6379 redis, …), so clients
  // can rely on the URL scheme's default — the explicit `:5432` was noise.
  const publicConnectionString = adapter.buildConnectionString({
    username,
    password,
    host: publicHostname,
    databaseName,
    sslmode: "require",
    sslnegotiation: "direct",
  });
  const internalConnectionString = adapter.buildConnectionString({
    username,
    password,
    host: internalHostname,
    port: adapter.port,
    databaseName,
  });

  let created: Awaited<ReturnType<typeof createDatabaseResourceRecord>>;
  try {
    created = await createDatabaseResourceRecord({
      projectId: input.projectId,
      name: input.name,
      engine,
      status: "draft",
      databaseName,
      username,
      password,
      publicEnabled,
      publicHostname,
      publicPort: PLATFORM.database.publicPort,
      publicConnectionString,
      internalHostname,
      internalPort: adapter.port,
      internalConnectionString,
      upstreamHost: internalHostname,
      upstreamPort: adapter.port,
      caddyLayer4Snippet: "",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      yield {
        type: "error",
        code: "CONFLICT",
        message: `Resource '${input.name}' was created concurrently`,
      };
      return;
    }
    yield {
      type: "error",
      code: "DB_INSERT_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
    return;
  }
  yield { type: "step", step: "db-record", status: "ok", message: null };

  // Hand the wizard off here. We build the PostgresResource view inline
  // from the just-inserted record instead of calling mapDatabaseResource,
  // which would trigger ensureSwarmRuntimeForRecord — and that function
  // re-provisions the swarm service synchronously when it doesn't see a
  // runtime yet. We *haven't created the runtime* at this point (that's
  // the next step), so calling it here would block the `created` yield
  // on the full 30s provision, defeating the whole point of the early
  // hand-off. The "starting" runtime placeholder is honest about the
  // state — the resource page can render a spinner and the Logs tab will
  // attach once the container actually comes up.
  yield {
    type: "created",
    resource: {
      resourceId: created.resource.id,
      projectId: created.resource.projectId,
      name: created.resource.name,
      type: "database" as const,
      status: created.resource.status,
      engine,
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
        serviceName: containerName,
        volumeName,
        networkName: `otterdeploy-${projectSlug}`,
        status: "starting",
        health: "starting",
      },
      extraEnv: created.database.extraEnv ?? {},
      secretKeys: created.database.secretKeys ?? [],
      extensions: created.database.extensions ?? [],
    },
  };

  // ── Pull the postgres image (or confirm it's already cached) ─────────
  // Pulling on the manager before docker.services.create means the service's
  // first task starts immediately instead of stalling on a layer download
  // — and gives the operator live byte-level feedback rather than 30s of
  // silence on the first deploy of a new postgres version.
  const dbImage = adapter.defaultImage;
  yield {
    type: "step",
    step: "image-pull",
    status: "start",
    message: dbImage,
  };
  const pullDocker = Docker.fromEnv();
  try {
    // Public image today; resolver returns null, no auth header sent. The
    // wiring is here so when private engine builds (custom postgres
    // extensions, redis modules, etc.) land via the Registry Credentials
    // settings page, the pull site picks them up without changes.
    const pullAuth = await resolveRegistryAuth({
      image: dbImage,
      organizationId: input.organizationId,
    });
    let pullError: string | null = null;
    for await (const event of streamImagePull(pullDocker, dbImage, pullAuth)) {
      yield {
        type: "pull",
        image: event.image,
        id: event.id,
        status: event.status,
        progress: event.progress,
        current: event.current,
        total: event.total,
      };
      // streamImagePull surfaces docker errors as a final pull event with
      // the engine's error text in `status`; convert it to a terminal error.
      if (/^(error|denied|manifest unknown|toomanyrequests)/i.test(event.status)) {
        pullError = event.status;
        break;
      }
    }
    if (pullError) {
      yield { type: "step", step: "image-pull", status: "error", message: pullError };
      yield { type: "error", code: "IMAGE_PULL_FAILED", message: pullError };
      return;
    }
    yield { type: "step", step: "image-pull", status: "ok", message: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "step", step: "image-pull", status: "error", message };
    yield { type: "error", code: "IMAGE_PULL_FAILED", message };
    return;
  } finally {
    pullDocker.destroy();
  }

  // ── Record the deployment ────────────────────────────────────────────
  // Insert the row BEFORE provision so the spec we hand to swarm already
  // carries the deployment-id label. Failures from this point on are
  // attributable to a deployment in the UI's Deployments tab.
  const deploymentRow = await insertDeployment({
    resourceId: created.resource.id,
    image: dbImage,
    reason: "create",
    snapshot: snapshotForPostgresCreate({
      image: dbImage,
      databaseName,
      username,
      password,
      publicEnabled,
      publicHostname,
      internalHostname,
      extraEnv: {},
    }),
  });

  // ── Provision the swarm service ──────────────────────────────────────
  yield { type: "step", step: "provision-swarm", status: "start", message: null };
  let runtime: Awaited<ReturnType<typeof provisionSwarmDatabase>>;
  try {
    runtime = await provisionSwarmDatabase(
      {
        engine,
        resourceId: created.resource.id,
        image: dbImage,
        serviceName: containerName,
        volumeName,
        hostnameAlias: internalHostname,
        databaseName,
        username,
        password,
        projectSlug,
        deploymentId: deploymentRow.id,
        public: publicEnabled,
      },
      log,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDeploymentFailed(deploymentRow.id, message);
    yield {
      type: "error",
      code: "SWARM_PROVISION_FAILED",
      message,
    };
    return;
  }
  yield {
    type: "step",
    step: "provision-swarm",
    status: runtime.status === "error" ? "error" : "ok",
    message: `service status: ${runtime.status}`,
  };

  // ── Tail container boot output for a few seconds ─────────────────────
  // wait-ready already polled the service to running; now show what
  // postgres actually said while it came up. The tail stops as soon as we
  // see the canonical "ready to accept connections" line, or after the
  // deadline elapses — whichever comes first. Failures here are non-fatal
  // because the service is already up; we just lose visibility, not the DB.
  yield { type: "step", step: "container-logs", status: "start", message: null };
  try {
    for await (const event of tailContainerBootLogs({
      serviceName: containerName,
      timeoutMs: 8_000,
      readyPattern: adapter.readyPattern,
    })) {
      yield { type: "log", stream: event.stream, line: event.line };
    }
    yield { type: "step", step: "container-logs", status: "ok", message: null };
  } catch (err) {
    yield {
      type: "step",
      step: "container-logs",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // ── Caddy proxy route (only when explicitly public) ──────────────────
  if (publicEnabled) {
    yield { type: "step", step: "caddy-route", status: "start", message: null };
    await insertProxyRoute({
      projectId: input.projectId,
      resourceId: created.resource.id,
      type: "layer4",
      domain: publicHostname,
      upstreamHost: internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
      protocol: "tcp",
      layer4Alpn: "postgresql",
      // ACME only when the resolver returned a verified non-sslip domain.
      usesAcme: resolved.verified && resolved.source !== "sslip-fallback",
    });
    yield { type: "step", step: "caddy-route", status: "ok", message: null };
  }

  // ── Reconcile the running Caddy config ───────────────────────────────
  yield { type: "step", step: "caddy-reconcile", status: "start", message: null };
  const reconcileResult = await reconcile(log);
  const isApplied = reconcileResult.applied.includes(input.projectId);
  yield {
    type: "step",
    step: "caddy-reconcile",
    status: isApplied ? "ok" : "error",
    message: isApplied ? null : "Caddy reconcile reported the project as skipped",
  };

  await updateDatabaseResourceStatus(
    created.resource.id,
    isApplied ? "valid" : "invalid",
  );

  // ── Done: ship the mapped resource so the wizard can route ───────────
  const mapped = await mapDatabaseResource(
    {
      ...created,
      resource: {
        ...created.resource,
        status: isApplied ? "valid" : "invalid",
      },
    },
    project.slug,
  );
  yield { type: "done", resource: mapped };
}
