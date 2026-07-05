/**
 * Postgres `extraEnv` write path + the thin editor wrappers that build the
 * desired env map (set/unset a key, rollback to a snapshot). All mutations
 * funnel through `applyPostgresExtraEnv`, which is the only way the postgres
 * container env array changes after creation — it inserts a deployment row,
 * persists the new env, and rolls the swarm task.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";

import { defaultImageFor } from "../../../swarm";
import { syncManifestDatabaseExtraEnv } from "../manifest";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtraEnv,
} from "../queries";
import { mapDatabaseResource, type PostgresResource } from "../views";
import { rollDatabaseContainer } from "./roll";
import { type PostgresSnapshotV1 } from "./snapshot";

/**
 * Shared write path for editor mutations on `extraEnv`. Persists the new map,
 * then rolls the swarm service with the merged Env array. The DB user/pass/
 * db rows are derived from the resource record — they're never read from
 * `extraEnv` — so a stale or malicious key in the editor can't displace the
 * database identity.
 */
export async function applyPostgresExtraEnv(
  ref: ProjectRef & { resourceId: ResourceId; nextExtraEnv: Record<string, string> },
  log: RequestLogger,
): Promise<Result<PostgresResource, ProjectNotFoundError | PostgresResourceNotFoundError>> {
  log.set({
    resource: { kind: "postgres", projectId: ref.projectId, id: ref.resourceId },
    extraEnv: { keys: Object.keys(ref.nextExtraEnv) },
  });

  const project = await getProjectInOrg({
    projectId: ref.projectId,
    organizationId: ref.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: ref.projectId }));
  }

  const record = await getDatabaseResourceRecord(ref.projectId, ref.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: ref.resourceId }));
  }

  await setDatabaseResourceExtraEnv(ref.resourceId, ref.nextExtraEnv);

  // BUG GUARD: read the engine off the DB record and use it for both
  // the deployment image and the swarm update. The legacy
  // `updateSwarmPostgres` hardcoded `engine: "postgres"`, which silently
  // replaced redis/mariadb/mongo containers with postgres on every env
  // change. Always route through `updateSwarmDatabase` with the actual
  // engine from the record.
  const engine = record.database.engine;
  // Extension-resolved image, not the bare engine default — an env change on
  // a pgvector/postgis/timescale database must not downgrade its image.
  const resolvedImage = resolvePostgresImage(
    record.database.extensions ?? [],
    defaultImageFor(engine),
  );
  const engineImage = resolvedImage.ok ? resolvedImage.image : defaultImageFor(engine);

  // Roll the running container with the new env (volume + network stay put;
  // ~5s of dropped connections). rollDatabaseContainer owns the deployment
  // row + eager status bookkeeping.
  await rollDatabaseContainer(
    {
      record,
      projectSlug: project.slug,
      image: engineImage,
      reason: "env-change",
      extraEnv: ref.nextExtraEnv,
    },
    log,
  );

  // Keep a DECLARED manifest extraEnv truthful — otherwise the next
  // manifest.diff stages a phantom revert of this edit (same convention as
  // syncManifestDatabasePublic; a manifest that omits the key is untouched).
  await syncManifestDatabaseExtraEnv(
    { projectId: ref.projectId, organizationId: ref.organizationId },
    record.resource.name,
    ref.nextExtraEnv,
  );

  return Result.ok(
    await mapDatabaseResource(
      {
        resource: record.resource,
        database: { ...record.database, extraEnv: ref.nextExtraEnv },
      },
      project.slug,
    ),
  );
}

export async function setPostgresExtraEnvKey(
  input: ProjectRef & { resourceId: ResourceId; key: string; value: string },
  log: RequestLogger,
) {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
  const next = { ...record.database.extraEnv, [input.key]: input.value };
  return applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      nextExtraEnv: next,
    },
    log,
  );
}

export async function unsetPostgresExtraEnvKey(
  input: ProjectRef & { resourceId: ResourceId; key: string },
  log: RequestLogger,
) {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
  const current = { ...record.database.extraEnv };
  delete current[input.key];
  return applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      nextExtraEnv: current,
    },
    log,
  );
}

/**
 * Apply a postgres snapshot to its resource — the rollback primitive.
 * Today's postgres snapshot only records env-shaped data (the rest of
 * the postgres state — credentials, hostnames — is immutable across the
 * resource's lifetime), so rollback is "set extraEnv to the snapshot's
 * value." The result is ONE new deployment row (reason: "redeploy")
 * whose snapshot equals the snapshot we just replayed. If we later let
 * users edit publicEnabled etc., this function fans out the additional
 * setPostgres* calls in the same flow.
 */
export async function rollbackPostgresToSnapshot(
  input: ProjectRef & {
    resourceId: ResourceId;
    snapshot: PostgresSnapshotV1;
  },
  log: RequestLogger,
) {
  return applyPostgresExtraEnv(
    {
      projectId: input.projectId,
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      nextExtraEnv: input.snapshot.extraEnv,
    },
    log,
  );
}
