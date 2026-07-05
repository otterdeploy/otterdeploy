/**
 * Self-healing runtime hydration for database resources — split from
 * ./views.ts (same shape as the ./view-helpers split) so the view mappers
 * stay focused on row → API-shape translation.
 */
import { reconcile } from "../../caddy";
import { getProxyRouteByResourceId, updateProxyRoute } from "../../caddy/queries";
import { PLATFORM } from "../../constants";
import { inspectSwarmDatabaseRuntime, provisionSwarmDatabase } from "../../runtime/db";
import { defaultImageFor, type SwarmDatabaseRuntime } from "../../swarm";
import {
  deleteDeploymentById,
  getLatestDeploymentForResource,
  insertDeployment,
  markDeploymentFailed,
  reconcileDeploySuccess,
} from "./deployments";
import {
  updateDatabaseResourceRuntime,
  updateDatabaseResourceStatus,
  type DatabaseResourceRecord,
} from "./queries";
import { buildContainerName, buildVolumeName } from "./view-helpers";

// A freshly-created (or restarting) swarm service is INVISIBLE to `docker
// service inspect` for the first few seconds while it converges. Treat a
// deployment younger than this as "still converging", not "gone", so the
// self-heal below doesn't fire against a service that's simply not up yet.
const RECONCILE_GRACE_MS = 60_000;

// Serialize reconcile-on-read per resource. The control plane is a single
// process, so an in-process lock is enough to stop the fan-out where several
// concurrent reads (the create wizard's final map + the ~5s resource-list poll
// + the detail page) each saw the still-converging service as "missing" and
// each inserted its own `restart` deployment. Queued callers re-check under the
// lock and bail once the first has provisioned (or recorded) the recovery.
const reconcileLocks = new Map<string, Promise<unknown>>();
async function withReconcileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = reconcileLocks.get(key) ?? Promise.resolve();
  const current = prev.then(fn, fn);
  reconcileLocks.set(key, current);
  try {
    return await current;
  } finally {
    // Drop the entry only when nobody chained behind us, so the map can't grow
    // without bound across a long-lived process.
    if (reconcileLocks.get(key) === current) reconcileLocks.delete(key);
  }
}

/**
 * Inspects the live Swarm service for a database record and re-provisions it
 * if missing. Keeps the proxy route and DB status in sync with whatever the
 * Caddy reconciler reports.
 */
export async function ensureSwarmRuntimeForRecord(
  record: DatabaseResourceRecord,
  projectSlug: string,
): Promise<{ record: DatabaseResourceRecord; runtime: SwarmDatabaseRuntime }> {
  // Engine comes from the row, never from a hardcoded default — the
  // recovery path here used to call `provisionSwarmPostgres`, which
  // forced a postgres image regardless of what the user actually
  // created. That's how a "redis" resource ended up running
  // `postgres:17-alpine` after its first page load.
  const engine = record.database.engine;
  const serviceName = buildContainerName({
    engine,
    projectSlug,
    resourceName: record.resource.name,
  });
  const volumeName = buildVolumeName({
    engine,
    projectSlug,
    resourceName: record.resource.name,
  });

  const existingRuntime = await inspectSwarmDatabaseRuntime({
    serviceName,
    volumeName,
    projectSlug,
  });

  if (existingRuntime.status !== "missing") {
    return { record, runtime: existingRuntime };
  }

  // The swarm service looks gone. Recover it under a fresh `restart` deployment
  // — but serialize per resource and re-check first, so the post-create
  // convergence window (and the concurrent reads that hit it: the create
  // wizard's final map, the ~5s resource-list poll, the detail page) can't fan
  // out into several duplicate restarts.
  return withReconcileLock(record.resource.id, async () => {
    // Re-inspect under the lock: an earlier queued reconcile — or the create
    // that's still converging — may have brought the service up by now.
    const runtimeNow = await inspectSwarmDatabaseRuntime({ serviceName, volumeName, projectSlug });
    if (runtimeNow.status !== "missing") {
      return { record, runtime: runtimeNow };
    }

    // Dedup + grace: if any deployment for this resource is younger than the
    // grace window, the service is still converging (a just-created DB, or the
    // restart a prior lock-holder just inserted) — don't pile on another. This
    // is what turns the "genuinely removed → one restart" self-heal into exactly
    // one restart even under concurrent reads.
    const latest = await getLatestDeploymentForResource(record.resource.id);
    if (latest && Date.now() - new Date(latest.createdAt).getTime() < RECONCILE_GRACE_MS) {
      return { record, runtime: runtimeNow };
    }

    // Re-provision with the image that was actually running (extension-bundled
    // images aren't derivable from the engine default) — the latest deployment
    // row is the source of truth, same as restartDatabaseResource.
    const engineImage = latest?.image ?? defaultImageFor(engine);

    // Genuinely gone (manual `docker service rm`, drained node, etc.). Re-create
    // it under a fresh deployment so the recovery shows up in the Deployments tab.
    const restartDeployment = await insertDeployment({
      resourceId: record.resource.id,
      image: engineImage,
      reason: "restart",
      snapshot: {
        kind: "postgres",
        version: 1,
        image: engineImage,
        databaseName: record.database.databaseName,
        username: record.database.username,
        password: record.database.password,
        publicEnabled: record.database.publicEnabled,
        publicHostname: record.database.publicHostname,
        internalHostname: record.database.internalHostname,
        extraEnv: record.database.extraEnv ?? {},
      },
    });

    // Provision can throw (e.g. a concurrent create won the service-name race).
    // Mark the row failed rather than leave it stranded in "building" with no
    // task ever carrying its deployment.id label.
    let runtime: SwarmDatabaseRuntime;
    try {
      runtime = await provisionSwarmDatabase({
        engine,
        resourceId: record.resource.id,
        image: engineImage,
        serviceName,
        volumeName,
        hostnameAlias: record.database.internalHostname,
        databaseName: record.database.databaseName,
        username: record.database.username,
        password: record.database.password,
        projectSlug,
        deploymentId: restartDeployment.id,
        extraEnv: record.database.extraEnv ?? {},
        public: record.database.publicEnabled,
      });
    } catch (err) {
      await markDeploymentFailed(
        restartDeployment.id,
        err instanceof Error ? err.message : String(err),
      ).catch(() => undefined);
      throw err;
    }

    // Race close-out: provisionSwarmDatabase's own inner inspect may have found
    // the service already up (wasCreated === false) and never scheduled a task
    // carrying our restart deployment.id label — the row would stay BUILDING
    // with 0 tasks forever. Drop it; the other caller's row is the truthful one.
    if (runtime.wasCreated === false) {
      await deleteDeploymentById(restartDeployment.id);
      return { record, runtime };
    }

    // Provisioning waited for the container — flip the recovery deployment to
    // running eagerly instead of sitting on BUILDING until the next list poll.
    if (runtime.status === "running") {
      await reconcileDeploySuccess([restartDeployment.id], record.resource.id);
    }

    const existingRoute = await getProxyRouteByResourceId(record.resource.id);
    if (existingRoute) {
      await updateProxyRoute(existingRoute.id, {
        upstreamHost: record.database.internalHostname,
        upstreamPort: PLATFORM.database.internalPort,
      });
    }

    await updateDatabaseResourceRuntime({
      resourceId: record.resource.id,
      upstreamHost: record.database.internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
      caddyLayer4Snippet: "",
    });

    const reconcileResult = await reconcile();
    const isApplied = reconcileResult.applied.includes(record.resource.projectId);

    await updateDatabaseResourceStatus(record.resource.id, isApplied ? "valid" : "invalid");

    return {
      record: {
        resource: { ...record.resource, status: isApplied ? "valid" : "invalid" },
        database: {
          ...record.database,
          upstreamHost: record.database.internalHostname,
          upstreamPort: PLATFORM.database.internalPort,
          caddyLayer4Snippet: "",
        },
      },
      runtime,
    };
  });
}
