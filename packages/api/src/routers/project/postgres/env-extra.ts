/**
 * Postgres `extraEnv` write path + the thin editor wrappers that build the
 * desired env map (set/unset a key, rollback to a snapshot). All mutations
 * funnel through `applyPostgresExtraEnv`, which is the only way the postgres
 * container env array changes after creation, it inserts a deployment row,
 * persists the new env, and rolls the swarm task.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";
import { Result } from "better-result";

import type { ProjectRef } from "../../scopes";

import { defaultImageFor } from "../../../swarm";
import { getLatestDeploymentForResource } from "../deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import { syncManifestDatabaseExtraEnv } from "../manifest-env-sync";
import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtraEnv,
} from "../queries";
import { mapDatabaseResource, type PostgresResource } from "../views";
import { rollDatabaseContainer } from "./roll";

/**
 * Shared write path for editor mutations on `extraEnv`. Persists the new map,
 * then rolls the swarm service with the merged Env array. The DB user/pass/
 * db rows are derived from the resource record. They're never read from
 * `extraEnv`, so a stale or malicious key in the editor can't displace the
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
  // Base the roll on the image that's actually RUNNING (latest deployment
  // row), not the bare engine default: an env change must never downgrade a
  // pgvector/postgis/timescale image OR silently swap the operator's version
  // pick (postgres:18 → 17-alpine). Same precedent as restart.ts. The
  // extension resolver still wins when a non-contrib extension demands its
  // bundled image.
  const latest = await getLatestDeploymentForResource(ref.resourceId);
  const currentImage = latest?.image ?? defaultImageFor(engine);
  const resolvedImage = resolvePostgresImage(record.database.extensions ?? [], currentImage);
  const engineImage = resolvedImage.ok ? resolvedImage.image : currentImage;

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

  // Keep a DECLARED manifest extraEnv truthful. Otherwise the next
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
