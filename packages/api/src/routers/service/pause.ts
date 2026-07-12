/**
 * Pause / resume a service — an operator-facing "stop without losing
 * anything" primitive.
 *
 * Pause remembers the desired replica count in `pausedReplicas`, scales the
 * service to 0 (the runtime drivers honor replicas:0 by removing the running
 * container), and leaves config / env / routes / volumes untouched. Resume
 * restores the remembered count and clears the marker, so the UI can tell
 * "paused" apart from "an operator scaled this to zero on purpose".
 *
 * Both are idempotent: pausing a paused service (or resuming a non-paused
 * one) returns the current view without touching the runtime.
 */
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";

import { loadResource } from "./context";
import { type ResolveError, ServiceNotFoundError } from "./errors";
import { getService } from "./handlers";
import { type ResourceRef } from "./inputs";
import { setServiceReplicaState } from "./queries";
import { redeployOne } from "./redeploy";
import { type ServiceView } from "./views";

type NotFound = ProjectNotFoundError | ServiceNotFoundError;

export async function pauseService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound | ResolveError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record, project } = ctx.value;

  // Already paused — nothing to do.
  if (record.service.pausedReplicas != null) return getService(input);

  // Remember at least 1 so resuming a service that somehow sat at 0 desired
  // replicas still brings a container back.
  const remembered = Math.max(record.service.replicas, 1);
  await setServiceReplicaState(input.resourceId, {
    replicas: 0,
    pausedReplicas: remembered,
  });
  log.set({ pause: { service: record.service.serviceName, remembered } });

  // No dependent fan-out: pausing changes no env values, so services that
  // reference this one keep their resolved config (their requests will fail
  // until resume — that's the point of pausing).
  const rolled = await redeployOne(input.projectId, input.resourceId, project.slug, log);
  if (rolled.isErr()) return Result.err(rolled.error);

  return getService(input);
}

export async function resumeService(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<ServiceView, NotFound | ResolveError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  const { record, project } = ctx.value;

  // Not paused — nothing to restore.
  if (record.service.pausedReplicas == null) return getService(input);

  await setServiceReplicaState(input.resourceId, {
    replicas: record.service.pausedReplicas,
    pausedReplicas: null,
  });
  log.set({
    resume: { service: record.service.serviceName, replicas: record.service.pausedReplicas },
  });

  const rolled = await redeployOne(input.projectId, input.resourceId, project.slug, log);
  if (rolled.isErr()) return Result.err(rolled.error);

  return getService(input);
}
