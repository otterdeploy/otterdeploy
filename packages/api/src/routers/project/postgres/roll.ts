/**
 * THE way to roll an existing database container. Every spec change that must
 * recreate the container (env change, restart, extension image swap) goes
 * through here, so the status bookkeeping can't be forgotten at a call site:
 * insert the deployment row → roll via the runtime driver → mark the row
 * failed on throw → flip it to running eagerly the moment the driver confirms
 * the container is up (no waiting on the next list poll).
 *
 * Deliberately NOT used by:
 *  - `setPostgresPublic` — public access is edge-only (a Caddy layer4 route);
 *    it never rolls the container at all.
 *  - `ensureSwarmRuntimeForRecord` (runtime recovery) — that path *provisions*
 *    a missing container and has its own race close-out (wasCreated) + grace
 *    logic around the deployment row.
 */
import type { RequestLogger } from "evlog";

import { updateSwarmDatabase } from "../../../runtime/db";
import { insertDeployment, markDeploymentFailed, reconcileDeploySuccess } from "../deployments";
import { type DatabaseResourceRecord } from "../queries";
import { buildContainerName, buildVolumeName, sanitizeProjectSlug } from "../views";
import { snapshotForPostgresCreate } from "./snapshot";

export async function rollDatabaseContainer(
  args: {
    record: DatabaseResourceRecord;
    projectSlug: string;
    /** Image the rolled container must run — extension-resolved by the
     *  caller (never a bare engine default; see resolvePostgresImage). */
    image: string;
    reason: "env-change" | "restart" | "redeploy";
    /** Env map for the rolled container. Defaults to the record's current
     *  extraEnv; env-change passes the next map. */
    extraEnv?: Record<string, string>;
    /** Extensions recorded on the snapshot. Defaults to the record's list;
     *  the extension swap passes the desired set. */
    extensions?: string[];
  },
  log?: RequestLogger,
): Promise<Awaited<ReturnType<typeof updateSwarmDatabase>>> {
  const { record, projectSlug, image, reason } = args;
  const db = record.database;
  const engine = db.engine;
  const extraEnv = args.extraEnv ?? db.extraEnv ?? {};

  const deployment = await insertDeployment({
    resourceId: record.resource.id,
    image,
    reason,
    snapshot: snapshotForPostgresCreate({
      image,
      databaseName: db.databaseName,
      username: db.username,
      password: db.password,
      publicEnabled: db.publicEnabled,
      publicHostname: db.publicHostname,
      internalHostname: db.internalHostname,
      extraEnv,
      extensions: args.extensions ?? db.extensions ?? undefined,
    }),
  });

  let rolled: Awaited<ReturnType<typeof updateSwarmDatabase>>;
  try {
    rolled = await updateSwarmDatabase(
      {
        engine,
        resourceId: record.resource.id,
        image,
        serviceName: buildContainerName({
          engine,
          projectSlug,
          resourceName: record.resource.name,
        }),
        volumeName: buildVolumeName({
          engine,
          projectSlug,
          resourceName: record.resource.name,
        }),
        hostnameAlias: db.internalHostname,
        databaseName: db.databaseName,
        username: db.username,
        password: db.password,
        projectSlug: sanitizeProjectSlug(projectSlug),
        deploymentId: deployment.id,
        extraEnv,
        public: db.publicEnabled,
      },
      log,
    );
  } catch (err) {
    // Never strand the row at BUILDING with no task carrying its label.
    await markDeploymentFailed(deployment.id, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // The driver waited for the rolled container — persist the running flip now
  // so the graph pill, panel badge and Deployments card agree immediately.
  if (rolled.status === "running") {
    await reconcileDeploySuccess([deployment.id], record.resource.id);
  }

  return rolled;
}
