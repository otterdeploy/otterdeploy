/**
 * Service env-var mutations — `setEnv` / `unsetEnv` / `bulkSetEnv`. Split out of
 * handlers.ts to keep that file under the line cap; re-exported from there so
 * the router import path is unchanged. Each mutation fans a redeploy out to the
 * service and any dependents that reference its variables.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { syncManifestServiceEnv } from "../project/manifest";
import { loadResource } from "./context";
import { ServiceNotFoundError, type ResolveError } from "./errors";
import { type ResourceRef } from "./inputs";
import {
  bulkReplaceServiceEnvVars,
  deleteServiceEnvVar,
  listServiceEnvVars,
  upsertServiceEnvVar,
} from "./queries";
import { redeployAndFanOut } from "./redeploy";
import { mapEnvVar, type EnvVarView } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

export async function setEnv(
  input: ResourceRef & { key: string; value: string },
  log: RequestLogger,
): Promise<Result<EnvVarView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const row = await upsertServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
    value: input.value,
  });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(mapEnvVar(row));
}

export async function unsetEnv(
  input: ResourceRef & { key: string },
  log: RequestLogger,
): Promise<Result<{ ok: true }, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const removed = await deleteServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
  });
  if (!removed) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok({ ok: true });
}

/**
 * Keep the saved manifest truthful after a LIVE env edit (variables tab, CLI
 * `env set`) — patches a declared env map to the applied rows so the next
 * diff doesn't stage phantom deletes, or resurrect a deleted var on Apply.
 *
 * Called from the ROUTER endpoints only, never from the manifest reconciler's
 * own bulkSetEnv path: apply writes ref-RESOLVED values and skips unset
 * `${secret}` keys, so syncing from inside apply would destroy those
 * declarations. Best-effort — a failure must never fail the env mutation.
 */
export async function syncManifestEnvAfterLiveEdit(input: ResourceRef): Promise<void> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return;
  const rows = await listServiceEnvVars(input.resourceId);
  await syncManifestServiceEnv(
    { projectId: input.projectId, organizationId: input.organizationId },
    ctx.value.record.resource.name,
    Object.fromEntries(rows.map((r) => [r.key, r.value])),
  );
}

export async function bulkSetEnv(
  input: ResourceRef & { vars: Array<{ key: string; value: string }> },
  log: RequestLogger,
): Promise<Result<EnvVarView[], RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const rows = await bulkReplaceServiceEnvVars(input.resourceId, input.vars);
  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(rows.map(mapEnvVar));
}
