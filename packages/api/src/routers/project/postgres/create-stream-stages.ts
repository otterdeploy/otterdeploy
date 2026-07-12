/**
 * Stage implementations for the postgres create stream. Each stage is an async
 * generator that yields `CreatePostgresProgress` events and `return`s a small
 * outcome the orchestrator delegates to with `yield*` — so a stage failure can
 * terminate the whole stream while still emitting partial progress. The derived
 * context + view-building live in ./create-stream-context.
 */
import type { DeploymentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";

import type { CreatePostgresProgress } from "./create-stream";

import { reconcile } from "../../../caddy";
import { insertProxyRoute } from "../../../caddy/queries";
import { PLATFORM } from "../../../constants";
import { createStackDeployLog } from "../../../lib/deploy-log";
import { provisionSwarmDatabase } from "../../../runtime/db";
import { createPullLineSummarizer, resolveRegistryAuth, streamImagePull } from "../../../swarm";
import { insertDeployment, markDeploymentFailed, reconcileDeploySuccess } from "../deployments";
import { createDatabaseResourceRecord } from "../queries";
import { isUniqueViolation } from "../views";
import { tailContainerBootLogs } from "./boot-logs";
import {
  buildCreatedResourceView,
  type CreateContext,
  type CreatedRecord,
} from "./create-stream-context";
import { snapshotForPostgresCreate } from "./snapshot";

type StageOutcome = { ok: true } | { ok: false };
type StageResult<T> = { ok: true; value: T } | { ok: false };

// Insert the row as `draft` before any docker work so the wizard can hand off
// to the resource page within milliseconds — image pulls, provisioning, and
// caddy reconcile all keep streaming in the background.
export async function* persistDbRecordStage(
  input: { projectId: ProjectId; name: string },
  ctx: CreateContext,
): AsyncGenerator<CreatePostgresProgress, StageResult<CreatedRecord>, void> {
  yield { type: "step", step: "db-record", status: "start", message: null };
  let created: CreatedRecord;
  try {
    created = await createDatabaseResourceRecord({
      projectId: input.projectId,
      name: input.name,
      engine: ctx.engine,
      status: "draft",
      databaseName: ctx.databaseName,
      username: ctx.username,
      password: ctx.password,
      publicEnabled: ctx.publicEnabled,
      publicHostname: ctx.publicHostname,
      publicPort: PLATFORM.database.publicPort,
      publicConnectionString: ctx.publicConnectionString,
      internalHostname: ctx.internalHostname,
      internalPort: ctx.adapter.port,
      internalConnectionString: ctx.internalConnectionString,
      upstreamHost: ctx.internalHostname,
      upstreamPort: ctx.adapter.port,
      caddyLayer4Snippet: "",
      extensions: ctx.extensions,
      extraEnv: ctx.extraEnv,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      yield {
        type: "error",
        code: "CONFLICT",
        message: `Resource '${input.name}' was created concurrently`,
      };
      return { ok: false };
    }
    yield {
      type: "error",
      code: "DB_INSERT_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
    return { ok: false };
  }
  yield { type: "step", step: "db-record", status: "ok", message: null };
  yield { type: "created", resource: buildCreatedResourceView(created, ctx) };
  return { ok: true, value: created };
}

// Record the deployment row BEFORE the image pull so the whole create — pull
// included — reads as one `building` deployment. Without it the graph card
// sees "container missing + no deployment" during a long pull and shows a
// phantom error. The id also rides the swarm spec labels so every task links
// back to this row.
export async function insertCreateDeployment(
  resourceId: ResourceId,
  ctx: CreateContext,
): Promise<{ id: DeploymentId }> {
  return insertDeployment({
    resourceId,
    image: ctx.dbImage,
    reason: "create",
    snapshot: snapshotForPostgresCreate({
      image: ctx.dbImage,
      databaseName: ctx.databaseName,
      username: ctx.username,
      password: ctx.password,
      publicEnabled: ctx.publicEnabled,
      publicHostname: ctx.publicHostname,
      internalHostname: ctx.internalHostname,
      extraEnv: ctx.extraEnv,
      extensions: ctx.extensions,
    }),
  });
}

// Pull the image on the manager before docker.services.create so the service's
// first task starts immediately instead of stalling on a layer download — and
// gives the operator live byte-level feedback rather than 30s of silence.
export async function* pullImageStage(
  image: string,
  organizationId: string,
  deploymentId: DeploymentId,
): AsyncGenerator<CreatePostgresProgress, StageOutcome, void> {
  yield { type: "step", step: "image-pull", status: "start", message: image };
  const pullDocker = Docker.fromEnv();
  // Mirror pull progress into deployment_log + the Redis live tail. The
  // wizard stream dies with the request, but the deploy log is what the
  // Deployments tab can replay later — and recent lines keep the zero-task
  // stale check from flipping a slow pull to "failed".
  const deployLog = createStackDeployLog(deploymentId);
  const summarize = createPullLineSummarizer();
  try {
    // Public image today; resolver returns null, no auth header sent. The
    // wiring is here so private engine builds pick up registry creds without
    // changes once they land.
    const pullAuth = await resolveRegistryAuth({ image, organizationId });
    let pullError: string | null = null;
    for await (const event of streamImagePull(pullDocker, image, pullAuth)) {
      const logLine = summarize.push(event);
      if (logLine) deployLog.line(logLine);
      yield {
        type: "pull",
        image: event.image,
        id: event.id,
        status: event.status,
        progress: event.progress,
        current: event.current,
        total: event.total,
      };
      // streamImagePull surfaces docker errors as a final pull event with the
      // engine's error text in `status`; convert it to a terminal error.
      if (/^(error|denied|manifest unknown|toomanyrequests)/i.test(event.status)) {
        pullError = event.status;
        break;
      }
    }
    if (pullError) {
      await markDeploymentFailed(deploymentId, `Image pull failed: ${pullError}`);
      yield { type: "step", step: "image-pull", status: "error", message: pullError };
      yield { type: "error", code: "IMAGE_PULL_FAILED", message: pullError };
      return { ok: false };
    }
    yield { type: "step", step: "image-pull", status: "ok", message: null };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDeploymentFailed(deploymentId, `Image pull failed: ${message}`);
    yield { type: "step", step: "image-pull", status: "error", message };
    yield { type: "error", code: "IMAGE_PULL_FAILED", message };
    return { ok: false };
  } finally {
    await deployLog.close();
    pullDocker.destroy();
  }
}

// Provision the swarm service under the already-recorded deployment row (see
// insertCreateDeployment — inserted before the pull stage).
export async function* provisionStage(
  resourceId: ResourceId,
  ctx: CreateContext,
  log: RequestLogger,
  deploymentRow: { id: DeploymentId },
): AsyncGenerator<CreatePostgresProgress, StageOutcome, void> {
  yield { type: "step", step: "provision-swarm", status: "start", message: null };
  let runtime: Awaited<ReturnType<typeof provisionSwarmDatabase>>;
  try {
    runtime = await provisionSwarmDatabase(
      {
        engine: ctx.engine,
        resourceId,
        image: ctx.dbImage,
        serviceName: ctx.containerName,
        volumeName: ctx.volumeName,
        hostnameAlias: ctx.internalHostname,
        databaseName: ctx.databaseName,
        username: ctx.username,
        password: ctx.password,
        projectSlug: ctx.projectSlug,
        deploymentId: deploymentRow.id as DeploymentId,
        extraEnv: ctx.extraEnv,
        public: ctx.publicEnabled,
      },
      log,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDeploymentFailed(deploymentRow.id, message);
    yield { type: "error", code: "SWARM_PROVISION_FAILED", message };
    return { ok: false };
  }
  // The driver already waited for the container to come up — persist the
  // building → running flip now so the Deployments card agrees with the live
  // runtime badge immediately, instead of a `deployments.list` poll later.
  if (runtime.status === "running") {
    await reconcileDeploySuccess([deploymentRow.id as DeploymentId], resourceId);
  }
  yield {
    type: "step",
    step: "provision-swarm",
    status: runtime.status === "error" ? "error" : "ok",
    message: `service status: ${runtime.status}`,
  };
  return { ok: true };
}

// Tail container boot output for a few seconds. Non-fatal: the service is
// already up, so failures here lose visibility, not the DB.
export async function* streamBootLogsStage(
  ctx: CreateContext,
): AsyncGenerator<CreatePostgresProgress, void, void> {
  yield { type: "step", step: "container-logs", status: "start", message: null };
  try {
    for await (const event of tailContainerBootLogs({
      serviceName: ctx.containerName,
      timeoutMs: 8_000,
      readyPattern: ctx.adapter.readyPattern,
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
}

// Insert the layer4 proxy route (only when explicitly public) then reconcile
// the running Caddy config. Returns whether the project applied cleanly.
export async function* publishAndReconcileStage(
  projectId: ProjectId,
  resourceId: ResourceId,
  ctx: CreateContext,
  log: RequestLogger,
): AsyncGenerator<CreatePostgresProgress, boolean, void> {
  if (ctx.publicEnabled) {
    yield { type: "step", step: "caddy-route", status: "start", message: null };
    await insertProxyRoute({
      projectId,
      resourceId,
      type: "layer4",
      domain: ctx.publicHostname,
      upstreamHost: ctx.internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
      protocol: "tcp",
      layer4Alpn: "postgresql",
      // ACME only when the resolver returned a verified non-sslip domain.
      usesAcme: ctx.resolved.verified && ctx.resolved.source !== "sslip-fallback",
    });
    yield { type: "step", step: "caddy-route", status: "ok", message: null };
  }

  yield { type: "step", step: "caddy-reconcile", status: "start", message: null };
  const reconcileResult = await reconcile(log);
  const isApplied = reconcileResult.applied.includes(projectId);
  yield {
    type: "step",
    step: "caddy-reconcile",
    status: isApplied ? "ok" : "error",
    message: isApplied ? null : "Caddy reconcile reported the project as skipped",
  };
  return isApplied;
}
