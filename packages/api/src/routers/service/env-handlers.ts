/**
 * Service env-var mutations: `setEnv` / `unsetEnv` / `bulkSetEnv`. Split out of
 * handlers.ts to keep that file under the line cap; re-exported from there so
 * the router import path is unchanged. Each mutation fans a redeploy out to the
 * service and any dependents that reference its variables.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { EnvVarSource } from "./queries";

import { syncManifestServiceEnv, type ManifestEnvTarget } from "../project/manifest-env-sync";
import { loadResource } from "./context";
import { rejectSelfReferences } from "./env-self-ref";
import { type RefSelfReferenceError, ServiceNotFoundError } from "./errors";
import { type ResourceRef } from "./inputs";
import {
  bulkReplaceServiceEnvVars,
  deleteServiceEnvVar,
  listServiceEnvVars,
  upsertServiceEnvVar,
} from "./queries";
import { getStackResourceName } from "./queries/stack";
import { rollAfterEnvChange, type RollFailure } from "./roll-after-env-change";
import { mapEnvVar, type EnvVarView } from "./views";

type RedeployFailure = RollFailure | RefSelfReferenceError;

/** The post-write roll, for all three mutations. A compose child's container
 *  is owned by its stack's reconcile, so the single-service roll would leave
 *  the old value live; `rollAfterEnvChange` picks the right owner. */
function rollFor(
  input: ResourceRef,
  ctx: {
    project: { slug: string };
    record: { service: { stackId?: ResourceId | null } };
  },
  log: RequestLogger,
): Promise<Result<true, RollFailure>> {
  return rollAfterEnvChange({
    projectId: input.projectId,
    resourceId: input.resourceId,
    projectSlug: ctx.project.slug,
    stackId: ctx.record.service.stackId,
    log,
  });
}

export async function setEnv(
  input: ResourceRef & { key: string; value: string },
  log: RequestLogger,
): Promise<Result<EnvVarView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  // Before the write: a value that reads this service's own env bag can never
  // resolve, so it must not be saved only to fail the redeploy.
  const guarded = await rejectSelfReferences(input.projectId, ctx.value.record, [input]);
  if (guarded.isErr()) return Result.err(guarded.error);

  const row = await upsertServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
    value: input.value,
    // `service.env.set` is the CLI's `env set` and the panel's single-row
    // apply: either way a human, not the manifest.
    source: "cli",
  });

  const redeployed = await rollFor(input, ctx.value, log);
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(mapEnvVar(row));
}

export async function unsetEnv(
  input: ResourceRef & { key: string },
  log: RequestLogger,
): Promise<Result<{ ok: true }, RollFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const removed = await deleteServiceEnvVar({
    serviceResourceId: input.resourceId,
    key: input.key,
  });
  if (!removed) {
    return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));
  }

  const redeployed = await rollFor(input, ctx.value, log);
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok({ ok: true });
}

/**
 * Keep the saved manifest truthful after a LIVE env edit (variables tab, CLI
 * `env set`). Patches a declared env map to the applied rows so the next
 * diff doesn't stage phantom deletes, or resurrect a deleted var on Apply.
 *
 * Called from the ROUTER endpoints only, never from the manifest reconciler's
 * own bulkSetEnv path: apply writes ref-RESOLVED values and skips unset
 * `${secret}` keys, so syncing from inside apply would destroy those
 * declarations. Best-effort: a failure must never fail the env mutation.
 */
/**
 * Which manifest slot this service's env belongs in.
 *
 * A stack child is addressed by its stack's RESOURCE name plus its own compose
 * key — the key, not the resource name, because `pickResourceName` renames a
 * child (`db` → `autumn-db`) while the compose key is what the file and the
 * manifest both speak. Null when a child has no compose key recorded, which
 * only pre-column rows can be: there is nowhere truthful to write it.
 */
async function manifestTargetFor(
  projectId: ProjectId,
  record: {
    resource: { name: string };
    service: { stackId?: ResourceId | null; composeService?: string | null };
  },
): Promise<ManifestEnvTarget | null> {
  const stackId = record.service.stackId;
  if (!stackId) return { kind: "service", name: record.resource.name };
  const composeService = record.service.composeService;
  if (!composeService) return null;
  const stackName = await getStackResourceName(projectId, stackId);
  return stackName ? { kind: "stackChild", stackName, composeService } : null;
}

export async function syncManifestEnvAfterLiveEdit(input: ResourceRef): Promise<void> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return;
  const rows = await listServiceEnvVars(input.resourceId);
  // A stack child lives under composes[stack].services[key], not services[].
  // Passing its resource name found nothing and returned, which is how every
  // child's env edit fell out of the manifest (od-uhot).
  const target = await manifestTargetFor(input.projectId, ctx.value.record);
  if (!target) return;
  await syncManifestServiceEnv(
    { projectId: input.projectId, organizationId: input.organizationId },
    target,
    Object.fromEntries(rows.map((r) => [r.key, r.value])),
  );
}

export async function bulkSetEnv(
  input: ResourceRef & {
    vars: Array<{ key: string; value: string }>;
    /** Who is writing. The manifest apply passes "manifest"; that is what
     *  lets the next diff tell its own rows from an operator's (od-y64.8). */
    source?: EnvVarSource;
  },
  log: RequestLogger,
): Promise<Result<EnvVarView[], RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const guarded = await rejectSelfReferences(input.projectId, ctx.value.record, input.vars);
  if (guarded.isErr()) return Result.err(guarded.error);

  const rows = await bulkReplaceServiceEnvVars(input.resourceId, input.vars, input.source ?? "ui");
  const redeployed = await rollFor(input, ctx.value, log);
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(rows.map(mapEnvVar));
}
