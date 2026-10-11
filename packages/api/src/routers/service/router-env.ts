/**
 * `service.env.*` oRPC procedures: split out of index.ts to keep the router
 * module under the line cap. Spread back in as `serviceRouter.env`.
 */
import { matchError, Result } from "better-result";
import { createError, log } from "evlog";

import type { StackRollFailedError } from "./errors";
import type { ResourceRef } from "./inputs";

import { projectScopedProcedure, requirePermission } from "../..";
import { listEffectiveEnv } from "./env-effective";
import { bulkSetEnv, listEnv, setEnv, syncManifestEnvAfterLiveEdit, unsetEnv } from "./handlers";

/** The env write committed and the stack roll did not, so this is a server
 *  failure, not bad input — but the message has to survive: it is the only
 *  thing telling the operator the value IS saved and the container is not
 *  running it yet. */
const stackRollToServerError = (e: StackRollFailedError) =>
  createError({
    message: e.message,
    status: 500,
    why: "The env write committed; the stack roll that would apply it failed",
    cause: e,
  });

/** Best-effort manifest back-sync after a live env edit. Must never fail the
 *  mutation that already succeeded. See syncManifestEnvAfterLiveEdit. */
async function backSync(ref: ResourceRef): Promise<void> {
  const synced = await Result.tryPromise({
    try: () => syncManifestEnvAfterLiveEdit(ref),
    catch: (cause) => cause,
  });
  if (synced.isErr()) {
    log.warn({ serviceEnv: { step: "manifest-back-sync", resourceId: ref.resourceId } });
  }
}

export const serviceEnvRouter = {
  list: projectScopedProcedure.service.env.list.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await listEnv({
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        ServiceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  set: requirePermission({ service: ["update"] }).service.env.set.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await setEnv(
        {
          ...input,
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          RefMissingResourceError: () => errors.REF_MISSING(),
          RefCycleError: () => errors.REF_CYCLE(),
          RefParseError: () => errors.INVALID_INPUT(),
          RefUnknownVarError: () => errors.INVALID_INPUT(),
          // Caught at the write, so the message names the key and the token.
          RefSelfReferenceError: (e) => errors.INVALID_INPUT({ message: e.message }),
          // The value IS saved; only the stack roll failed. See the mapper.
          StackRollFailedError: stackRollToServerError,
          // A reference the operator can fix answers 400; a provider outage
          // answers 502, not a misleading input error.
          VaultResolveError: (e) =>
            e.unavailable
              ? errors.VAULT_UNAVAILABLE({ message: e.message })
              : errors.VAULT_UNRESOLVED({ message: e.message }),
        });
      }
      await backSync({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      return result.value;
    },
  ),

  unset: requirePermission({ service: ["update"] }).service.env.unset.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await unsetEnv(
        {
          ...input,
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          RefMissingResourceError: (e) => errors.REF_MISSING({ message: e.message }),
          RefCycleError: (e) => errors.REF_CYCLE({ message: e.message }),
          RefParseError: (e) => errors.INVALID_INPUT({ message: e.message }),
          RefUnknownVarError: (e) => errors.INVALID_INPUT({ message: e.message }),
          // The unset IS persisted; only the stack roll failed. See the mapper.
          StackRollFailedError: stackRollToServerError,
          VaultResolveError: (e) =>
            e.unavailable
              ? errors.VAULT_UNAVAILABLE({ message: e.message })
              : errors.VAULT_UNRESOLVED({ message: e.message }),
        });
      }
      await backSync({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      return result.value;
    },
  ),

  bulkSet: requirePermission({ service: ["update"] }).service.env.bulkSet.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await bulkSetEnv(
        {
          ...input,
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          RefMissingResourceError: () => errors.REF_MISSING(),
          RefCycleError: () => errors.REF_CYCLE(),
          RefParseError: () => errors.INVALID_INPUT(),
          RefUnknownVarError: () => errors.INVALID_INPUT(),
          // Caught at the write, so the message names the key and the token.
          RefSelfReferenceError: (e) => errors.INVALID_INPUT({ message: e.message }),
          // The value IS saved; only the stack roll failed. See the mapper.
          StackRollFailedError: stackRollToServerError,
          // A reference the operator can fix answers 400; a provider outage
          // answers 502, not a misleading input error.
          VaultResolveError: (e) =>
            e.unavailable
              ? errors.VAULT_UNAVAILABLE({ message: e.message })
              : errors.VAULT_UNRESOLVED({ message: e.message }),
        });
      }
      await backSync({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      return result.value;
    },
  ),

  /** The bag with `${{…}}` expanded. Read-only, and masked: see
   *  env-effective.ts for why that is not negotiable. */
  effective: projectScopedProcedure.service.env.effective.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await listEffectiveEnv({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
