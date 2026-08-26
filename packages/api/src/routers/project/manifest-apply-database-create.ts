/**
 * Database CREATE for the manifest reconciler.
 *
 * Split from the update half because the two share nothing but a table: create
 * drains the whole provisioning stream (and owns the rollback when it fails),
 * while update is a handful of declared-only field reconciliations.
 *
 * Staged extensions + extraEnv are BAKED into the create (image + env resolved
 * up-front) so everything deploys as one container; the only follow-up is
 * running CREATE EXTENSION against the live database.
 */
import type { EnvironmentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";

import type { HostRow } from "../../database-hosting";
import type { DatabaseManifest } from "../../stack/manifest";
import type { PostgresCreateValidation } from "./postgres/create-stream";

import { dropTenant } from "../../database-hosting";
import { destroySwarmDatabase } from "../../runtime/db";
import { ManifestApplySkipError } from "./errors";
import { manifestExtensions } from "./manifest-apply-databases";
import { lookupDatabaseId } from "./manifest-apply-support";
import { createPostgresResourceStream, validatePostgresCreate } from "./postgres/create-stream";
import { deriveInternalDbCredentials } from "./postgres/credentials";
import { ensurePersistedExtensionsLive } from "./postgres/extensions";
import {
  deleteDraftCredential,
  deleteResourceById,
  getDraftCredentialPassword,
  setDatabaseResourcePreviewBranching,
} from "./queries";
import { buildContainerName } from "./views";

interface CreateDatabaseArgs {
  projectId: ProjectId;
  /** Environment the database is created in. Scopes the name check and gets
   *  stamped on the row. */
  environmentId: EnvironmentId;
  organizationId: OrganizationId;
  name: string;
  spec: DatabaseManifest;
  log: RequestLogger;
}

interface DrainedCreate {
  success: boolean;
  errorMessage: string | null;
  createdResourceId: ResourceId | null;
}

// Drain the create stream, capturing the terminal outcome + the created
// resource id so a failure can roll the draft row back.
async function drainCreateStream(
  stream: ReturnType<typeof createPostgresResourceStream>,
): Promise<DrainedCreate> {
  let success = false;
  let errorMessage: string | null = null;
  let createdResourceId: ResourceId | null = null;
  for await (const event of stream) {
    // The mapped view types `resourceId` as plain string; narrow with the
    // real prefix guard instead of asserting.
    if (event.type === "created" && hasPrefix(event.resource.resourceId, ID_PREFIX.resource)) {
      createdResourceId = event.resource.resourceId;
    }
    if (event.type === "done") success = true;
    if (event.type === "error") errorMessage = event.message;
  }
  return { success, errorMessage, createdResourceId };
}

/**
 * Everything that must hold before a row is written: the project exists, the
 * name is free in this environment, and — when the manifest declares one — the
 * server named actually exists and can take this engine.
 *
 * Both failures are SKIPS with a readable reason rather than throws: an apply
 * reconciles many resources, and one unusable database entry must not abort
 * the others.
 */
async function preflight(
  args: CreateDatabaseArgs,
): Promise<Result<PostgresCreateValidation, ManifestApplySkipError>> {
  // `host` names another database resource; resolve it to an id before the
  // create so an unknown name is a skip with a readable reason rather than a
  // dedicated container quietly appearing where a tenant was asked for.
  const declaredHost = "host" in args.spec ? args.spec.host : undefined;
  const hostResourceId = declaredHost
    ? await resolveHostByName({
        projectId: args.projectId,
        environmentId: args.environmentId,
        name: declaredHost,
      })
    : null;
  if (declaredHost && !hostResourceId) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason: `host "${declaredHost}" is not a database in this project`,
      }),
    );
  }

  const validation = await validatePostgresCreate({
    projectId: args.projectId,
    organizationId: args.organizationId,
    name: args.name,
    environmentId: args.environmentId,
    hostResourceId,
    engine: args.spec.engine,
  });
  if (validation.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason: `validation failed: ${validation.error.message}`,
      }),
    );
  }
  return Result.ok(validation.value);
}

export async function createDatabase(
  args: CreateDatabaseArgs,
): Promise<Result<{ name: string }, ManifestApplySkipError>> {
  const preflighted = await preflight(args);
  if (preflighted.isErr()) return Result.err(preflighted.error);
  const { project, host } = preflighted.value;

  // Reuse the password minted when the database was staged (shown in the
  // pending panel), so the connection details the operator copied pre-deploy
  // keep working. Null → the create stream generates a fresh one.
  const draftPassword = (await getDraftCredentialPassword(args.projectId, args.name)) ?? undefined;

  const stream = createPostgresResourceStream(
    {
      projectId: args.projectId,
      // Stamp the row into the environment the apply runs in. Dropping this
      // left environment_id NULL, and NULL rows only render because the main
      // environment owns them by convention. A create in a non-main
      // environment would land in the wrong one entirely (od-lqm).
      environmentId: args.environmentId,
      organizationId: args.organizationId,
      name: args.name,
      engine: args.spec.engine,
      // The wizard's version pick rides the manifest. Without this the
      // create silently deployed the catalog default tag (e.g. 17-alpine
      // when the operator chose 18).
      version: args.spec.version,
      publicEnabled: args.spec.publicEnabled ?? false,
      password: draftPassword,
      // Staged extensions + env deploy as part of THIS create: the stream
      // resolves the image from the extension set and bakes the env into the
      // container, so no follow-up image-swap or env-roll redeploy runs.
      extensions: manifestExtensions(args.spec),
      extraEnv: args.spec.extraEnv ?? {},
      host,
      connectionLimit: "connectionLimit" in args.spec ? (args.spec.connectionLimit ?? null) : null,
      project,
    },
    args.log,
  );

  // The same deterministic derivation the create used, so a rollback drops
  // exactly what the create would have made (see ./postgres/credentials).
  const derived = deriveInternalDbCredentials({
    engine: args.spec.engine,
    projectSlug: project.slug,
    resourceName: args.name,
    password: "",
  });

  const { success, errorMessage, createdResourceId } = await drainCreateStream(stream);
  if (success && createdResourceId && args.spec.previews) {
    // Manifest declared preview branching at create time, flag the fresh row.
    await setDatabaseResourcePreviewBranching(createdResourceId, true);
  }
  if (!success) {
    await rollbackFailedCreate({
      args,
      createdResourceId,
      host,
      projectSlug: project.slug,
      derived,
    });
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason: errorMessage ?? "create stream ended without done event",
      }),
    );
  }
  // Provisioned: the real database_resource row now owns the password, so the
  // staged draft credential is redundant. Drop it.
  await deleteDraftCredential(args.projectId, args.name);

  // Image + env were baked into the create above; the persisted extension
  // list still needs its CREATE EXTENSION statements against the live DB.
  if (createdResourceId) {
    await ensurePersistedExtensionsLive(
      { projectId: args.projectId, resourceId: createdResourceId },
      args.log,
    );
  }

  return Result.ok({ name: args.name });
}

/**
 * Undo what a failed create left behind.
 *
 * Both halves are best-effort and the ROW goes either way: a half-created
 * database that keeps its row lands in loadCurrentState, the next diff reads
 * the manifest entry as already-existing and flips create → no-op, and the
 * ghost can never be cleanly retried.
 *
 * What gets torn down differs by placement. A dedicated database leaves a
 * container holding the name (which would 409 every retry) but keeps its
 * volume, because the bytes are the one thing worth more than a clean retry.
 * A hosted database has no container at all — what it can leave is a database
 * and a role on someone else's server, and those hold the name.
 */
async function rollbackFailedCreate(input: {
  args: CreateDatabaseArgs;
  createdResourceId: ResourceId | null;
  host: HostRow | null;
  projectSlug: string;
  derived: { databaseName: string; username: string };
}): Promise<void> {
  if (input.createdResourceId) await deleteResourceById(input.createdResourceId);
  const { host, args, derived } = input;
  await Result.tryPromise({
    try: () =>
      host
        ? dropTenant(
            {
              host,
              tenant: {
                databaseName: derived.databaseName,
                username: derived.username,
                password: "",
              },
            },
            args.log,
          )
        : destroySwarmDatabase(
            {
              serviceName: buildContainerName({
                engine: args.spec.engine,
                projectSlug: input.projectSlug,
                resourceName: args.name,
              }),
            },
            args.log,
          ),
    catch: (e: unknown) => e,
  });
}

/**
 * Resolve a manifest `host` name to a database resource id within the project.
 *
 * Deliberately the same lookup the reconciler uses for every other
 * name → resource resolution in an apply (`lookupDatabaseId`), so a manifest
 * that says `host: pg` picks the same `pg` the rest of the apply means.
 */
async function resolveHostByName(input: {
  projectId: ProjectId;
  environmentId: EnvironmentId;
  name: string;
}): Promise<ResourceId | null> {
  return lookupDatabaseId(input.projectId, input.name);
}
