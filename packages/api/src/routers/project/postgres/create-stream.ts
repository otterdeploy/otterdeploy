import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
/**
 * Postgres database-resource orchestration. Owns the create lifecycle for a
 * Postgres resource attached to a project, including the Swarm provision and
 * Caddy proxy-route bookkeeping. Read/delete are handled generically in
 * resources.ts. The per-stage implementations live in ./create-stream-stages.
 */
import type { EnvironmentId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { HostRow } from "../../../database-hosting";
import type { ProjectRef } from "../../scopes";

import { DatabaseHostingError, resolveHostForTenant } from "../../../database-hosting";
import { PostgresResourceConflictError, ProjectNotFoundError } from "../errors";
import {
  getDatabaseResourceByProjectAndName,
  resolveEnvironmentScope,
  getProjectInOrg,
  updateDatabaseResourceStatus,
} from "../queries";
import { mapDatabaseResource, type PostgresResource } from "../views";
import {
  type CreateContext,
  type CreatedRecord,
  prepareCreateContext,
} from "./create-stream-context";
import {
  insertCreateDeployment,
  persistDbRecordStage,
  provisionStage,
  publishAndReconcileStage,
  pullImageStage,
  streamBootLogsStage,
} from "./create-stream-stages";
import { hostedProvisionStage } from "./hosted-stage";

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

/** What a successful pre-flight yields: the project the row lands in, and the
 *  resolved server it lives inside (null for a dedicated container). */
export interface PostgresCreateValidation {
  project: { id: string; slug: string };
  host: HostRow | null;
}

/**
 * Pre-flight validation for the create stream. Runs the synchronous checks
 * (project ownership + name conflict) BEFORE any provisioning begins, so
 * the router can throw the right oRPC error before the stream opens. After
 * this returns ok, the generator can safely start yielding step events.
 */
export async function validatePostgresCreate(
  input: ProjectRef & {
    name: string;
    environmentId?: EnvironmentId;
    /** Shared server to carve this database out of, if any. Resolved here so
     *  a bad host is a pre-flight refusal rather than a half-created row. */
    hostResourceId?: ResourceId | null;
    engine?: DatabaseEngine;
  },
): Promise<
  Result<
    PostgresCreateValidation,
    ProjectNotFoundError | PostgresResourceConflictError | DatabaseHostingError
  >
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // Same-environment names only. A `postgres` in production must not block a
  // `postgres` in staging: they are different rows under
  // resource_project_name_env_unique.
  const environmentScope = resolveEnvironmentScope(project, input.environmentId);
  const existing = environmentScope
    ? await getDatabaseResourceByProjectAndName(input.projectId, input.name, environmentScope)
    : undefined;
  if (existing) {
    return Result.err(new PostgresResourceConflictError({ name: input.name }));
  }

  // The host is resolved BEFORE anything is written down, so an unusable
  // server (wrong engine, itself a tenant, an engine that can't host) is a
  // refusal the operator reads in the wizard rather than a database row whose
  // provisioning fails halfway through.
  const hostResourceId = input.hostResourceId;
  if (!hostResourceId) {
    return Result.ok({ project: { id: project.id, slug: project.slug }, host: null });
  }
  const resolved = await Result.tryPromise({
    try: () =>
      resolveHostForTenant({
        organizationId: input.organizationId,
        hostResourceId,
        engine: input.engine ?? "postgres",
      }),
    catch: (error: unknown) =>
      error instanceof DatabaseHostingError
        ? error
        : new DatabaseHostingError("host_not_found", String(error)),
  });
  if (resolved.isErr()) return Result.err(resolved.error);

  return Result.ok({ project: { id: project.id, slug: project.slug }, host: resolved.value });
}

/**
 * Streaming postgres create. Pre-flight failures (missing project, name
 * conflict) are validated separately by validatePostgresCreate() so the
 * router can throw the right oRPC error before the stream opens. Once
 * the stream is open, runtime failures surface as `error` events instead
 * of throws so the wizard can render partial progress.
 *
 * The body is a sequence of stage generators (see ./create-stream-stages);
 * each yields its own progress events and signals success/failure back so a
 * failed stage terminates the stream after emitting what it can.
 */
export async function* createPostgresResourceStream(
  input: ProjectRef & {
    name: string;
    /** Environment the row is stamped into. Absent → NULL, which the read
     *  path treats as the project's main environment (inEnvironmentScope). */
    environmentId?: EnvironmentId;
    /** Database engine to provision. Default is postgres for back-compat
     *  with callers that haven't plumbed the param through yet. */
    engine?: DatabaseEngine;
    /** Image tag the operator picked (wizard version / manifest `version`).
     *  Omitted → the engine's catalog default tag. */
    version?: string;
    publicEnabled?: boolean;
    /** Pre-minted password from the stage-time draft. When set, the provision
     *  reuses it so the credentials the operator saw pre-deploy stay valid.
     *  Absent (e.g. legacy direct-create) → a fresh random password. */
    password?: string;
    /** Staged postgres extensions, baked into the create (image resolved
     *  up-front) so no post-create image-swap redeploy runs. */
    extensions?: string[];
    /** Staged user env, baked into the container at create. */
    extraEnv?: Record<string, string>;
    /** Resolved shared server this database is carved out of. Comes from
     *  validatePostgresCreate, which refuses a host of the wrong engine, a
     *  host that is itself a tenant, and an engine that can't host at all —
     *  so by the time the stream sees it, it is known-good. */
    host?: HostRow | null;
    /** Cap on the tenant's concurrent connections (shared-server only). */
    connectionLimit?: number | null;
    /** Output of validatePostgresCreate so we don't re-fetch the project. */
    project: { id: string; slug: string };
  },
  log: RequestLogger,
): AsyncGenerator<CreatePostgresProgress, void, void> {
  // Note: log.set() calls inside this generator's body are no-ops.
  // Hono/evlog flushes the wide event when the response starts streaming,
  // which is BEFORE the first .next() on this generator. The handler sets
  // the audit-relevant fields eagerly before returning the iterator.
  const ctx = await prepareCreateContext(input);

  const dbRecord = yield* persistDbRecordStage(input, ctx);
  if (!dbRecord.ok) return;
  const created = dbRecord.value;

  // The deployment row spans the FULL create (pull included) so the UI has
  // an honest `building` to show while the container doesn't exist yet, and a
  // pull failure lands on the row as a real `failed` + error message.
  const deploymentRow = await insertCreateDeployment(created.resource.id, ctx);

  // A database on a shared server has no image to pull, no container to start
  // and no boot output to tail: it is a `CREATE DATABASE` inside a container
  // that is already running. The whole swarm half of the create is skipped
  // rather than run against something that doesn't exist.
  if (ctx.host) {
    const hosted = yield* hostedProvisionStage(created.resource.id, ctx, log, deploymentRow);
    if (!hosted.ok) return;
    yield* finishCreate(created, ctx, hosted.healthy);
    return;
  }

  const pull = yield* pullImageStage(ctx.dbImage, input.organizationId, deploymentRow.id);
  if (!pull.ok) return;

  const provisioned = yield* provisionStage(created.resource.id, ctx, log, deploymentRow);
  if (!provisioned.ok) return;

  yield* streamBootLogsStage(ctx);

  yield* publishAndReconcileStage(input.projectId, created.resource.id, ctx, log);

  yield* finishCreate(created, ctx, provisioned.healthy);
}

/**
 * Stamp the final status and ship the mapped resource. Shared by both create
 * paths so a tenant and a dedicated database can't drift on what "done" means:
 * the resource is valid when the thing that backs it actually came up.
 *
 * The Caddy reconcile above is deliberately NOT part of this: it fails
 * routinely in dev (no proxy running) and covers routes an internal-only
 * database may not even have, so keying `resource.status` off it left healthy
 * databases stamped "invalid" forever.
 */
async function* finishCreate(
  created: CreatedRecord,
  ctx: CreateContext,
  healthy: boolean,
): AsyncGenerator<CreatePostgresProgress, void, void> {
  const status = healthy ? "valid" : "invalid";
  await updateDatabaseResourceStatus(created.resource.id, status);
  const mapped = await mapDatabaseResource(
    {
      ...created,
      resource: {
        ...created.resource,
        status,
      },
    },
    ctx.project.slug,
  );
  yield { type: "done", resource: mapped };
}
