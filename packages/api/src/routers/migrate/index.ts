/**
 * Platform-migration router (od-b34a). Install-admin only, same posture as
 * the system router: organization roles grant no authority here, because
 * detection reads the HOST's docker daemon.
 *
 * The apply endpoint re-plans server-side rather than accepting a plan from
 * the client: the wire plan carries env KEYS only (values must never round-
 * trip through a browser), so the authoritative plan — values included — is
 * rebuilt from Coolify's DB at apply time and the client's `projects` list
 * merely selects from it.
 */
import type { RequestLogger } from "evlog";

import { requireInstallAdmin } from "../..";
import { applyCoolifyPlan } from "./apply";
import {
  CoolifyNotFoundError,
  detectPlatforms,
  planCoolifyImport,
  type CoolifyPlan,
} from "./coolify";
import { detectPlatformsOnServer } from "./detect-server";

interface CoolifyErrors {
  COOLIFY_NOT_FOUND: (opts: { message: string }) => Error;
  COOLIFY_UNREADABLE: () => Error;
}

/** The plan, or the contract error its failure maps to (both
 *  used to be an evlog error oRPC does not recognise, an untyped 502). */
async function readCoolifyPlan(errors: CoolifyErrors, log: RequestLogger): Promise<CoolifyPlan> {
  const plan = await planCoolifyImport();
  if (plan.isOk()) return plan.value;
  if (plan.error instanceof CoolifyNotFoundError) {
    throw errors.COOLIFY_NOT_FOUND({ message: plan.error.message });
  }
  // The detail stays in the request log: it is about Coolify's own database.
  log.set({ coolify: { readError: plan.error.message } });
  throw errors.COOLIFY_UNREADABLE();
}

/** Strip env VALUES for the wire (the plan preview shows keys only). */
function toWirePlan(plan: CoolifyPlan) {
  return {
    version: plan.version,
    warnings: plan.warnings,
    projects: plan.projects.map((project) => ({
      name: project.name,
      databases: project.databases,
      // The clone URL stays server-side: it can carry credentials.
      services: project.services.map(({ env, cloneUrl: _cloneUrl, ...rest }) => ({
        ...rest,
        envKeys: env.map((e) => e.key),
      })),
    })),
  };
}

export const migrateRouter = {
  detect: requireInstallAdmin().migrate.detect.handler(async () => {
    return detectPlatforms();
  }),

  detectOnServer: requireInstallAdmin().migrate.detectOnServer.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "server", id: input.serverId }, action: "migrate.detect" });
      // Branded by the contract (serverIdField): the handler used to re-parse
      // a looser string and throw the ZodError, an untyped 500.
      return detectPlatformsOnServer({
        serverId: input.serverId,
        organizationId: context.activeOrganizationId,
      });
    },
  ),

  coolifyPlan: requireInstallAdmin().migrate.coolifyPlan.handler(async ({ context, errors }) => {
    context.log.set({ target: { type: "platform" }, action: "migrate.coolify-plan" });
    return toWirePlan(await readCoolifyPlan(errors, context.log));
  }),

  coolifyApply: requireInstallAdmin().migrate.coolifyApply.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "platform" }, action: "migrate.coolify-apply" });
      const plan = await readCoolifyPlan(errors, context.log);
      const wanted = new Set(input?.projects ?? []);
      const selected =
        wanted.size === 0
          ? plan
          : { ...plan, projects: plan.projects.filter((p) => wanted.has(p.name)) };
      return applyCoolifyPlan({
        plan: selected,
        organizationId: context.activeOrganizationId,
        log: context.log,
      });
    },
  ),
};
