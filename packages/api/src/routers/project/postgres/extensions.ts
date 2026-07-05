/**
 * Postgres extension management.
 *
 * `setPostgresExtensions` is the single write path. It:
 *   1. validates the requested set against the shared catalog,
 *   2. resolves the image the service must run — contrib-only extensions
 *      keep the default image; a non-contrib extension (pgvector / postgis /
 *      timescaledb) forces the bundled image. Two extensions that demand
 *      different images are an INVALID_INPUT conflict.
 *   3. persists the list, inserts a deployment row, and rolls the swarm
 *      service with the resolved image,
 *   4. best-effort applies CREATE / DROP EXTENSION against the live database.
 *
 * Step 4 needs a network path from the control plane to the target DB. It
 * works when the DB is public or the control plane shares the project
 * overlay; otherwise it's logged and skipped — the persisted list + image
 * are still correct, and a later toggle (or a reachable apply) converges.
 * The swap to a docker-exec transport (psql inside the container) would
 * remove that reachability caveat; the SQL itself is unchanged.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import {
  knownPostgresExtensions,
  resolvePostgresImage,
} from "@otterdeploy/shared/postgres-extensions";
import { Result } from "better-result";
import { SQL } from "bun";

import type { ProjectRef } from "../../scopes";

import { updateSwarmDatabase } from "../../../runtime/db";
import { defaultImageFor } from "../../../swarm";
import { insertDeployment, markDeploymentFailed } from "../deployments";
import {
  IncompatibleExtensionsError,
  PostgresResourceNotFoundError,
  ProjectNotFoundError,
} from "../errors";
import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  setDatabaseResourceExtensions,
} from "../queries";
import {
  buildContainerName,
  buildVolumeName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "../views";
import { snapshotForPostgresCreate } from "./snapshot";

export async function setPostgresExtensions(
  input: ProjectRef & { resourceId: ResourceId; extensions: string[] },
  log: RequestLogger,
): Promise<
  Result<
    PostgresResource,
    ProjectNotFoundError | PostgresResourceNotFoundError | IncompatibleExtensionsError
  >
> {
  // Drop anything the catalog doesn't know — a stale/forged name must never
  // reach CREATE EXTENSION. De-dupe so the diff below is clean.
  const desired = [...new Set(knownPostgresExtensions(input.extensions))];

  log.set({
    resource: { kind: "postgres", projectId: input.projectId, id: input.resourceId },
    extensions: { requested: input.extensions, applied: desired },
  });

  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const engine = record.database.engine;
  const defaultImage = defaultImageFor(engine);
  const resolved = resolvePostgresImage(desired, defaultImage);
  if (!resolved.ok) {
    return Result.err(new IncompatibleExtensionsError({ conflict: resolved.conflict }));
  }
  const image = resolved.image;

  const previous = record.database.extensions ?? [];
  await setDatabaseResourceExtensions(input.resourceId, desired);

  // Redeploy ONLY when the toggle changes the image the container must run
  // (pgvector / postgis / timescaledb). Contrib extensions ship in every
  // image — for those, CREATE EXTENSION below is the whole change, and the
  // "~0 downtime" promise in the UI holds because nothing restarts.
  const previousResolved = resolvePostgresImage(previous, defaultImage);
  const previousImage = previousResolved.ok ? previousResolved.image : defaultImage;
  if (image !== previousImage) {
    const deployment = await insertDeployment({
      resourceId: input.resourceId,
      image,
      reason: "redeploy",
      snapshot: snapshotForPostgresCreate({
        image,
        databaseName: record.database.databaseName,
        username: record.database.username,
        password: record.database.password,
        publicEnabled: record.database.publicEnabled,
        publicHostname: record.database.publicHostname,
        internalHostname: record.database.internalHostname,
        extraEnv: record.database.extraEnv ?? {},
        extensions: desired,
      }),
    });

    try {
      await updateSwarmDatabase(
        {
          engine,
          resourceId: input.resourceId,
          image,
          serviceName: buildContainerName({
            engine,
            projectSlug: project.slug,
            resourceName: record.resource.name,
          }),
          volumeName: buildVolumeName({
            engine,
            projectSlug: project.slug,
            resourceName: record.resource.name,
          }),
          hostnameAlias: record.database.internalHostname,
          databaseName: record.database.databaseName,
          username: record.database.username,
          password: record.database.password,
          projectSlug: sanitizeProjectSlug(project.slug),
          deploymentId: deployment.id,
          extraEnv: record.database.extraEnv ?? {},
          public: record.database.publicEnabled,
        },
        log,
      );
    } catch (err) {
      await markDeploymentFailed(deployment.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // Diff old → new and apply the delta to the running database. Best-effort:
  // the persisted state is already correct, so a failure here is logged, not
  // fatal — the operator sees the toggle stick and can re-trigger once the DB
  // is reachable.
  const toEnable = desired.filter((e) => !previous.includes(e));
  const toDisable = previous.filter((e) => !desired.includes(e));
  if (toEnable.length > 0 || toDisable.length > 0) {
    await applyExtensionsLive(
      dedupe([record.database.internalConnectionString, record.database.publicConnectionString]),
      toEnable,
      toDisable,
      log,
    );
  }

  return Result.ok(
    await mapDatabaseResource(
      {
        resource: record.resource,
        database: { ...record.database, extensions: desired },
      },
      project.slug,
    ),
  );
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

/**
 * Run CREATE EXTENSION for every extension already persisted on the record.
 * The manifest create path bakes extensions into the container image + row
 * up-front (one deploy, no post-create image swap), which leaves no delta
 * for `setPostgresExtensions` to apply — this covers the SQL half. Idempotent
 * (IF NOT EXISTS) and best-effort, like the live path.
 */
export async function ensurePersistedExtensionsLive(
  input: { projectId: ProjectId; resourceId: ResourceId },
  log: RequestLogger,
): Promise<void> {
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) return;
  const extensions = record.database.extensions ?? [];
  if (extensions.length === 0) return;
  await applyExtensionsLive(
    dedupe([record.database.internalConnectionString, record.database.publicConnectionString]),
    extensions,
    [],
    log,
  );
}

/**
 * Connects to the live database and applies the extension delta. Tries each
 * connection string in turn (internal overlay first, public second) and
 * stops at the first that connects. Names are catalog-validated upstream so
 * the quoted interpolation is safe. Never throws — returns whether it
 * applied so the caller can log it.
 */
async function applyExtensionsLive(
  connectionStrings: string[],
  toEnable: string[],
  toDisable: string[],
  log: RequestLogger,
): Promise<boolean> {
  for (const url of connectionStrings) {
    let sql: SQL | null = null;
    try {
      sql = new SQL({ url, max: 1, connectionTimeout: 5, idleTimeout: 5 });
      for (const name of toEnable) {
        await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "${name}"`);
      }
      for (const name of toDisable) {
        await sql.unsafe(`DROP EXTENSION IF EXISTS "${name}"`);
      }
      log.set({ extensionsApply: { ok: true, enabled: toEnable, disabled: toDisable } });
      return true;
    } catch (err) {
      log.set({
        extensionsApply: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      // Try the next connection string.
    } finally {
      await sql?.end().catch(() => {});
    }
  }
  return false;
}
