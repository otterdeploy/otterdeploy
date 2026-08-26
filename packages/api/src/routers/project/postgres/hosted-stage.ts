/**
 * The create stage for a database that lives on a shared server.
 *
 * Its own file because it is not a variant of the swarm provision — it
 * replaces the pull, the provision and the boot-log tail outright. There is no
 * image to fetch and no container to wait for: the server is already running,
 * so the only work is the statements that carve out the database, and the only
 * failure mode is the statements themselves.
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import type { CreatePostgresProgress } from "./create-stream";
import type { CreateContext } from "./create-stream-context";

import { provisionTenant } from "../../../database-hosting";
import { markDeploymentFailed } from "../deployments";
import { reconcileDeploySuccess } from "../deployments-reconcile";

/** Same outcome shape the swarm provision stage returns, so the orchestrator
 *  treats both paths identically. */
type ProvisionOutcome = { ok: true; healthy: boolean } | { ok: false };

// Carve the database out of an existing server instead of starting a container
// for it. Replaces the pull + provision + boot-tail stages entirely: there is
// no image to pull and no container to wait for, so the only failure mode is
// the plan itself (see database-hosting).
export async function* hostedProvisionStage(
  resourceId: ResourceId,
  ctx: CreateContext,
  log: RequestLogger,
  deploymentRow: { id: DeploymentId },
): AsyncGenerator<CreatePostgresProgress, ProvisionOutcome, void> {
  const host = ctx.host;
  if (!host) return { ok: true, healthy: true };
  yield {
    type: "step",
    step: "provision-tenant",
    status: "start",
    message: `server: ${host.name}`,
  };
  try {
    await provisionTenant(
      {
        host,
        tenant: {
          databaseName: ctx.databaseName,
          username: ctx.username,
          password: ctx.password,
          connectionLimit: ctx.connectionLimit,
        },
      },
      log,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDeploymentFailed(deploymentRow.id, message);
    yield { type: "step", step: "provision-tenant", status: "error", message };
    yield { type: "error", code: "TENANT_PROVISION_FAILED", message };
    return { ok: false };
  }
  // The database exists the moment the statements return — there is no
  // container convergence to wait on — so the deployment closes out here.
  await reconcileDeploySuccess([deploymentRow.id], resourceId);
  yield {
    type: "step",
    step: "provision-tenant",
    status: "ok",
    message: `database ${ctx.databaseName} on ${host.name}`,
  };
  return { ok: true, healthy: true };
}
