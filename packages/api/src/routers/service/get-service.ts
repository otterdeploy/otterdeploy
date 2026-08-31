/**
 * One service, as a view.
 *
 * Four lines, in their own module, for an import-graph reason: `expose.ts`
 * needed only this out of `handlers.ts`, and `handlers.ts` re-exports the env
 * mutations. That single edge dragged env-handlers into
 * compose/deploy -> reconcile -> reconcile-rollout -> expose, so the moment
 * the env path needed to roll a stack (od-eb2c) the chain closed into a cycle.
 * Reading it from a leaf instead keeps the static graph acyclic.
 *
 * `handlers.ts` re-exports it, so every existing caller is unchanged.
 */
import { Result } from "better-result";

import type { ProjectNotFoundError } from "../project/errors";
import type { ServiceNotFoundError } from "./errors";
import type { ResourceRef } from "./inputs";

import { loadResource } from "./context";
import { mapServiceView, type ServiceView } from "./views";

export async function getService(
  input: ResourceRef,
): Promise<Result<ServiceView, ProjectNotFoundError | ServiceNotFoundError>> {
  const ctx = await loadResource(input);
  if (ctx.isErr()) return Result.err(ctx.error);
  return Result.ok(await mapServiceView(ctx.value.record, ctx.value.project.slug));
}
