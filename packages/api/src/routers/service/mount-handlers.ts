/**
 * Service persistent-volume mutations — `listVolumeMounts` / `addVolumeMount` /
 * `removeVolumeMount`. A volume mount is one `service_mount` row of type
 * "volume": a docker named volume attached at a container path that survives
 * redeploys. The DB + runtime plumbing already exists (service_mount ->
 * materializeServiceMounts -> buildSwarmSpec reads mounts every deploy); these
 * handlers are the imperative surface the CLI/API call to declare one.
 *
 * Each mutation persists the row, then redeploys the service so the new mount
 * set takes effect immediately (mirrors the env-var flow). The redeploy path is
 * infra-fault-tolerant (see redeployOne), so a transient swarm error surfaces
 * as an error node rather than failing the write.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { loadResource } from "./context";
import { ServiceNotFoundError, type ResolveError } from "./errors";
import { type ResourceRef } from "./inputs";
import { deleteServiceMount, listServiceMounts, upsertServiceMount } from "./queries/mounts";
import { redeployAndFanOut } from "./redeploy";
import { buildServiceVolumeName, normalizeMountPath } from "./volume-name";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;
type RedeployFailure = NotFound | ResolveError;

/** One persistent volume attached to a service. */
export interface VolumeMountView {
  /** Container path the volume is mounted at (canonical form). */
  mountPath: string;
  /** The docker named volume backing it. */
  volumeName: string;
  readOnly: boolean;
}

function toView(row: {
  target: string;
  source: string | null;
  readOnly: boolean;
}): VolumeMountView {
  return { mountPath: row.target, volumeName: row.source ?? "", readOnly: row.readOnly };
}

export async function listVolumeMounts(
  input: ResourceRef,
): Promise<Result<VolumeMountView[], NotFound>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const rows = await listServiceMounts(input.resourceId);
  return Result.ok(rows.filter((m) => m.type === "volume").map(toView));
}

export async function addVolumeMount(
  input: ResourceRef & { mountPath: string; readOnly?: boolean },
  log: RequestLogger,
): Promise<Result<VolumeMountView, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const mountPath = normalizeMountPath(input.mountPath);
  const volumeName = buildServiceVolumeName({
    serviceName: ctx.value.record.service.serviceName,
    mountPath,
  });
  const row = await upsertServiceMount({
    serviceResourceId: input.resourceId,
    type: "volume",
    target: mountPath,
    source: volumeName,
    content: null,
    readOnly: input.readOnly ?? false,
  });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok(toView(row));
}

export async function removeVolumeMount(
  input: ResourceRef & { mountPath: string },
  log: RequestLogger,
): Promise<Result<{ ok: true }, RedeployFailure>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);

  const mountPath = normalizeMountPath(input.mountPath);
  // Only volume-type mounts are removable here; bind/file mounts (compose-seeded)
  // are managed elsewhere and must not be dropped by a `volume remove`.
  const existing = await listServiceMounts(input.resourceId);
  const target = existing.find((m) => m.target === mountPath && m.type === "volume");
  if (!target) return Result.err(new ServiceNotFoundError({ resourceId: input.resourceId }));

  await deleteServiceMount({ serviceResourceId: input.resourceId, target: mountPath });

  const redeployed = await redeployAndFanOut(
    input.projectId,
    input.resourceId,
    ctx.value.project.slug,
    log,
  );
  if (redeployed.isErr()) return Result.err(redeployed.error);

  return Result.ok({ ok: true });
}
