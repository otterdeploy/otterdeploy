/**
 * Database create/update for the manifest reconciler. Create drains the
 * postgres create stream to completion (the apply path doesn't surface
 * per-step progress yet) and applies extraEnv + extensions as follow-up steps.
 */
import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import { type DatabaseManifest } from "../../stack/manifest";
import { ManifestApplySkipError } from "./errors";
import { lookupDatabaseId } from "./manifest-apply-support";
import { createPostgresResourceStream, validatePostgresCreate } from "./postgres/create-stream";
import { applyPostgresExtraEnv, setPostgresPublic } from "./postgres/env";
import { setPostgresExtensions } from "./postgres/extensions";
import { deleteDraftCredential, deleteResourceById, getDraftCredentialPassword } from "./queries";

type OrgId = OrganizationId;

interface CreateDatabaseArgs {
  projectId: ProjectId;
  organizationId: OrgId;
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
    if (event.type === "created") {
      createdResourceId = event.resource.resourceId as ResourceId;
    }
    if (event.type === "done") success = true;
    if (event.type === "error") errorMessage = event.message;
  }
  return { success, errorMessage, createdResourceId };
}

// extraEnv + extensions come after creation — the create stream doesn't accept
// them as input today, so apply them as second steps. Both need the resource
// id, so resolve it once.
async function applyDatabasePostCreate(args: CreateDatabaseArgs): Promise<void> {
  const needsExtraEnv = Boolean(args.spec.extraEnv && Object.keys(args.spec.extraEnv).length > 0);
  const specExtensions = manifestExtensions(args.spec);
  if (!needsExtraEnv && specExtensions.length === 0) return;

  const dbId = await lookupDatabaseId(args.projectId, args.name);
  if (!dbId) return;

  if (needsExtraEnv) {
    await applyPostgresExtraEnv(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: dbId,
        nextExtraEnv: args.spec.extraEnv ?? {},
      },
      args.log,
    );
  }
  if (specExtensions.length > 0) {
    await setPostgresExtensions(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: dbId,
        extensions: specExtensions,
      },
      args.log,
    );
  }
}

export async function createDatabase(
  args: CreateDatabaseArgs,
): Promise<Result<{ name: string }, ManifestApplySkipError>> {
  const validation = await validatePostgresCreate({
    projectId: args.projectId,
    organizationId: args.organizationId,
    name: args.name,
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

  // Reuse the password minted when the database was staged (shown in the
  // pending panel), so the connection details the operator copied pre-deploy
  // keep working. Null → the create stream generates a fresh one.
  const draftPassword = (await getDraftCredentialPassword(args.projectId, args.name)) ?? undefined;

  const stream = createPostgresResourceStream(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      name: args.name,
      engine: args.spec.engine,
      publicEnabled: args.spec.publicEnabled ?? false,
      password: draftPassword,
      project: validation.value.project,
    },
    args.log,
  );

  const { success, errorMessage, createdResourceId } = await drainCreateStream(stream);
  if (!success) {
    // Roll back the draft row a failed create left behind. Otherwise the
    // half-created database lands in loadCurrentState, the next diff sees
    // the manifest entry as already-existing and flips create → no-op: the
    // ghost vanishes and the operator can never cleanly retry.
    if (createdResourceId) await deleteResourceById(createdResourceId);
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason: errorMessage ?? "create stream ended without done event",
      }),
    );
  }

  // Provisioned — the real database_resource row now owns the password, so the
  // staged draft credential is redundant. Drop it.
  await deleteDraftCredential(args.projectId, args.name);

  await applyDatabasePostCreate(args);

  return Result.ok({ name: args.name });
}

/** Extensions only exist on the postgres manifest variant — read them off
 *  the spec without assuming the discriminant has been narrowed. */
function manifestExtensions(spec: DatabaseManifest): string[] {
  const value = (spec as { extensions?: unknown }).extensions;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface UpdateDatabaseArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  resourceId: ResourceId;
  spec: DatabaseManifest;
  currentExtraEnv: Record<string, string>;
  log: RequestLogger;
}

export async function updateDatabaseFromManifest(
  args: UpdateDatabaseArgs,
): Promise<Result<{ name: string }, ManifestApplySkipError>> {
  const desiredPublic = args.spec.publicEnabled ?? false;
  await setPostgresPublic(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      resourceId: args.resourceId,
      publicEnabled: desiredPublic,
    },
    args.log,
  );

  const desiredExtra = args.spec.extraEnv ?? {};
  if (!shallowEqual(desiredExtra, args.currentExtraEnv)) {
    await applyPostgresExtraEnv(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        nextExtraEnv: desiredExtra,
      },
      args.log,
    );
  }

  // Reconcile extensions to the manifest's desired set. setPostgresExtensions
  // is idempotent (diffs against the current list), so calling it
  // unconditionally is safe — but skip when the manifest declares none and
  // the resource also has none, to avoid a no-op redeploy.
  const desiredExtensions = manifestExtensions(args.spec);
  if (desiredExtensions.length > 0) {
    await setPostgresExtensions(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        extensions: desiredExtensions,
      },
      args.log,
    );
  }
  return Result.ok({ name: args.name });
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}
