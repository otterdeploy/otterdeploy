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
import { createError } from "evlog";

import { requireInstallAdmin } from "../..";
import { applyCoolifyPlan } from "./apply";
import { detectPlatforms, planCoolifyImport, type CoolifyPlan } from "./coolify";

/** Strip env VALUES for the wire (the plan preview shows keys only). */
function toWirePlan(plan: CoolifyPlan) {
  return {
    version: plan.version,
    warnings: plan.warnings,
    projects: plan.projects.map((project) => ({
      name: project.name,
      databases: project.databases,
      services: project.services.map(({ env, ...rest }) => ({
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

  coolifyPlan: requireInstallAdmin().migrate.coolifyPlan.handler(async ({ context }) => {
    context.log.set({ target: { type: "platform" }, action: "migrate.coolify-plan" });
    const plan = await planCoolifyImport();
    if (plan.isErr()) {
      throw createError({ message: plan.error.message, status: 502, why: "coolify read failed" });
    }
    return toWirePlan(plan.value);
  }),

  coolifyApply: requireInstallAdmin().migrate.coolifyApply.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "platform" }, action: "migrate.coolify-apply" });
    const plan = await planCoolifyImport();
    if (plan.isErr()) {
      throw createError({ message: plan.error.message, status: 502, why: "coolify read failed" });
    }
    const wanted = new Set(input?.projects ?? []);
    const selected =
      wanted.size === 0
        ? plan.value
        : { ...plan.value, projects: plan.value.projects.filter((p) => wanted.has(p.name)) };
    return applyCoolifyPlan({
      plan: selected,
      organizationId: context.activeOrganizationId,
      log: context.log,
    });
  }),
};
