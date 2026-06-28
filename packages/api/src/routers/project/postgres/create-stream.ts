/**
 * Postgres database-resource orchestration. Owns the create lifecycle for a
 * Postgres resource attached to a project — including the Swarm provision and
 * Caddy proxy-route bookkeeping. Read/delete are handled generically in
 * resources.ts. The per-stage implementations live in ./create-stream-stages.
 */

import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { PostgresResourceConflictError, ProjectNotFoundError } from "../errors";
import {
  getDatabaseResourceByProjectAndName,
  getProjectInOrg,
  updateDatabaseResourceStatus,
} from "../queries";
import { mapDatabaseResource, type PostgresResource } from "../views";
import { prepareCreateContext } from "./create-stream-context";
import {
  persistDbRecordStage,
  provisionStage,
  publishAndReconcileStage,
  pullImageStage,
  streamBootLogsStage,
} from "./create-stream-stages";

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

  const existing = await getDatabaseResourceByProjectAndName(input.projectId, input.name);
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
 * The body is a sequence of stage generators (see ./create-stream-stages);
 * each yields its own progress events and signals success/failure back so a
 * failed stage terminates the stream after emitting what it can.
 */
export async function* createPostgresResourceStream(
  input: ProjectRef & {
    name: string;
    /** Database engine to provision. Default is postgres for back-compat
     *  with callers that haven't plumbed the param through yet. */
    engine?: DatabaseEngine;
    publicEnabled?: boolean;
    /** Pre-minted password from the stage-time draft. When set, the provision
     *  reuses it so the credentials the operator saw pre-deploy stay valid.
     *  Absent (e.g. legacy direct-create) → a fresh random password. */
    password?: string;
    /** Output of validatePostgresCreate so we don't re-fetch the project. */
    project: { id: string; slug: string };
  },
  log: RequestLogger,
): AsyncGenerator<CreatePostgresProgress, void, void> {
  // Note: log.set() calls inside this generator's body are no-ops —
  // hono/evlog flushes the wide event when the response starts streaming,
  // which is BEFORE the first .next() on this generator. The handler sets
  // the audit-relevant fields eagerly before returning the iterator.
  const ctx = await prepareCreateContext(input);

  const dbRecord = yield* persistDbRecordStage(input, ctx);
  if (!dbRecord.ok) return;
  const created = dbRecord.value;

  const pull = yield* pullImageStage(ctx.dbImage, input.organizationId);
  if (!pull.ok) return;

  const provisioned = yield* provisionStage(created.resource.id, ctx, log);
  if (!provisioned.ok) return;

  yield* streamBootLogsStage(ctx);

  const isApplied = yield* publishAndReconcileStage(input.projectId, created.resource.id, ctx, log);

  await updateDatabaseResourceStatus(created.resource.id, isApplied ? "valid" : "invalid");

  // ── Done: ship the mapped resource so the wizard can route ───────────
  const mapped = await mapDatabaseResource(
    {
      ...created,
      resource: {
        ...created.resource,
        status: isApplied ? "valid" : "invalid",
      },
    },
    ctx.project.slug,
  );
  yield { type: "done", resource: mapped };
}
