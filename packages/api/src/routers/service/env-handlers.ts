/**
 * Service env-var mutations — `setEnv` / `unsetEnv` / `bulkSetEnv`. Split out of
 * handlers.ts to keep that file under the line cap; re-exported from there so
 * the router import path is unchanged. Each mutation fans a redeploy out to the
 * service and any dependents that reference its variables.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { loadResource } from "./context";
import { ServiceNotFoundError, type ResolveError } from "./errors";
import { type ResourceRef } from "./inputs";
import { bulkReplaceServiceEnvVars, deleteServiceEnvVar, upsertServiceEnvVar } from "./queries";
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
