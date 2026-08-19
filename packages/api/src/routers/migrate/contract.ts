/**
 * Platform-migration contract (od-b34a): detect other deploy platforms
 * running on this host and import their workloads. Install-admin only —
 * detection reads the host's docker daemon and the import creates projects
 * in the caller's active organization.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "migrate";
const base = "/migrate";
const emptyInput = z.object({}).optional();

const detectedPlatformSchema = z.object({
  platform: z.enum(["coolify", "dokploy", "caprover"]),
  version: z.string().nullable(),
  containers: z.array(z.string()),
  importSupported: z.boolean(),
});

const plannedServiceSchema = z.object({
  name: z.string(),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  buildPack: z.string().nullable(),
  dockerfilePath: z.string().nullable(),
  sourceSubdir: z.string().nullable(),
  port: z.number().nullable(),
  domains: z.array(z.string()),
  // Keys only: plaintext env VALUES never transit to the browser. The plan
  // is a preview; values go Coolify-DB → server memory → encrypted rows.
  envKeys: z.array(z.string()),
  warnings: z.array(z.string()),
});

const plannedProjectSchema = z.object({
  name: z.string(),
  services: z.array(plannedServiceSchema),
  databases: z.array(
    z.object({
      name: z.string(),
      engine: z.enum(["postgres", "redis", "mariadb", "mongodb"]),
    }),
  ),
});

const coolifyPlanSchema = z.object({
  version: z.string().nullable(),
  projects: z.array(plannedProjectSchema),
  warnings: z.array(z.string()),
});

const importResultSchema = z.object({
  projects: z.array(
    z.object({
      coolifyProject: z.string(),
      slug: z.string().nullable(),
      services: z.number(),
      databases: z.number(),
      skipped: z.array(
        z.object({
          resource: z.enum(["service", "database", "env", "compose"]),
          name: z.string(),
          reason: z.string(),
        }),
      ),
      error: z.string().nullable(),
    }),
  ),
});

const applyInput = z.object({
  // Selection by Coolify project name (the plan's identity); empty = all.
  projects: z.array(z.string()).optional(),
});

export const migrateContract = {
  detect: oc
    .meta({ path: `${base}/detect`, tag, method: "GET" })
    .input(emptyInput)
    .output(z.array(detectedPlatformSchema)),

  coolifyPlan: oc
    .meta({ path: `${base}/coolify/plan`, tag, method: "POST" })
    .input(emptyInput)
    .output(coolifyPlanSchema),

  coolifyApply: oc
    .meta({ path: `${base}/coolify/apply`, tag, method: "POST" })
    .input(applyInput)
    .output(importResultSchema),
};
