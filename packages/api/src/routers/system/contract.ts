/**
 * Platform self-update contract (install-wide "Updates"). Version detection +
 * check + apply + a live progress event-iterator. Above the org resource
 * surface — reads need `platform:read`, apply/settings need `platform:update`
 * (enforced in index.ts).
 */
import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";

const tag = "system";
const base = "/system";
const emptyInput = z.object({}).optional();

const versionInfoSchema = z.object({
  current: z.string(),
  channel: z.string(),
  runtime: z.enum(["docker", "swarm"]),
  dryRun: z.boolean(),
});

const updateSettingsSchema = z.object({
  channel: z.string(),
  autoUpdateEnabled: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  availableVersion: z.string().nullable(),
  availableReleaseNotes: z.string().nullable(),
  availableReleaseUrl: z.string().nullable(),
  dismissedVersion: z.string().nullable(),
});

const saveUpdateSettingsInput = z.object({
  channel: z.string().optional(),
  autoUpdateEnabled: z.boolean().optional(),
  dismissedVersion: z.string().nullable().optional(),
});

const checkResultSchema = z.object({
  current: z.string(),
  latest: z.string().nullable(),
  updateAvailable: z.boolean(),
  notes: z.string().nullable(),
  url: z.string().nullable(),
  checkedAt: z.string(),
  simulated: z.boolean(),
});

const applyResultSchema = z.discriminatedUnion("started", [
  z.object({
    started: z.literal(true),
    dryRun: z.boolean(),
    targetVersion: z.string(),
  }),
  z.object({
    started: z.literal(false),
    reason: z.enum(["already-running", "no-update", "downgrade"]),
  }),
]);

const usageSectionSchema = z.object({
  count: z.number(),
  activeCount: z.number(),
  totalBytes: z.number(),
  reclaimableBytes: z.number(),
});

const reclaimTargetSchema = z.enum(["images", "build-cache", "containers", "branch-pool"]);

const branchPoolSchema = z.object({
  pool: z.string(),
  health: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  allocBytes: z.number().nullable(),
  freeBytes: z.number().nullable(),
  autotrim: z.boolean().nullable(),
  imagePath: z.string().nullable(),
  imageMaxBytes: z.number().nullable(),
  imagePhysicalBytes: z.number().nullable(),
  reclaimableBytes: z.number(),
  suggestGrowBytes: z.number().nullable(),
});

// Exported for the server router: per-node health entries (server.health)
// carry the same HostHealth shape, as reported by the health agents.
export const hostHealthSchema = z.object({
  memory: z.object({
    totalBytes: z.number(),
    availableBytes: z.number(),
    usedPct: z.number(),
    swapTotalBytes: z.number().nullable(),
    swapFreeBytes: z.number().nullable(),
  }),
  disk: z
    .object({
      path: z.string(),
      totalBytes: z.number(),
      freeBytes: z.number(),
      usedPct: z.number(),
    })
    .nullable(),
  docker: z
    .object({
      images: usageSectionSchema,
      containers: usageSectionSchema,
      volumes: usageSectionSchema,
      buildCache: usageSectionSchema,
    })
    .nullable(),
  branchPool: branchPoolSchema.nullable(),
  recommendations: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["info", "warning", "critical"]),
      title: z.string(),
      detail: z.string(),
      action: reclaimTargetSchema.nullable(),
    }),
  ),
  sampledAt: z.string(),
});

const reclaimInput = z.object({
  targets: z.array(reclaimTargetSchema).min(1),
});

const reclaimResultSchema = z.object({
  reclaimedBytes: z.number(),
  results: z.array(
    z.object({
      target: reclaimTargetSchema,
      ok: z.boolean(),
      reclaimedBytes: z.number(),
      error: z.string().nullable(),
    }),
  ),
});

const progressEventSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  level: z.enum(["info", "success", "error"]),
  phase: z.enum(["validate", "pull", "migrate", "recreate", "handoff", "done"]),
  message: z.string(),
});

const runSnapshotSchema = z.object({
  status: z.enum(["idle", "running", "succeeded", "failed"]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  targetVersion: z.string().nullable(),
  handedOff: z.boolean(),
  error: z.string().nullable(),
  logs: z.array(progressEventSchema),
});

const caddyfileSchema = z.object({
  caddyfile: z.string(),
  revision: z.string(),
});

export const systemContract = {
  version: oc
    .meta({ path: `${base}/version`, tag, method: "GET" })
    .input(emptyInput)
    .output(versionInfoSchema),

  /** Full install-wide rendered Caddyfile (secrets masked) — admin view. */
  caddyfile: oc
    .meta({ path: `${base}/caddyfile`, tag, method: "GET" })
    .input(emptyInput)
    .output(caddyfileSchema),

  updateSettings: {
    get: oc
      .meta({ path: `${base}/update-settings`, tag, method: "GET" })
      .input(emptyInput)
      .output(updateSettingsSchema),
    save: oc
      .meta({ path: `${base}/update-settings`, tag, method: "POST" })
      .input(saveUpdateSettingsInput)
      .output(updateSettingsSchema),
  },

  checkForUpdate: oc
    .meta({ path: `${base}/check-for-update`, tag, method: "POST" })
    .input(emptyInput)
    .output(checkResultSchema),

  apply: oc
    .meta({ path: `${base}/apply`, tag, method: "POST" })
    .input(emptyInput)
    .output(applyResultSchema),

  updateState: oc
    .meta({ path: `${base}/update-state`, tag, method: "GET" })
    .input(emptyInput)
    .output(runSnapshotSchema),

  progress: oc
    .meta({ path: `${base}/progress`, tag, method: "GET" })
    .input(emptyInput)
    .output(eventIterator(progressEventSchema)),

  hostHealth: oc
    .meta({ path: `${base}/host-health`, tag, method: "GET" })
    .input(emptyInput)
    .output(hostHealthSchema),

  reclaim: oc
    .meta({ path: `${base}/reclaim`, tag, method: "POST" })
    .input(reclaimInput)
    .output(reclaimResultSchema),

  growBranchPool: oc
    .meta({ path: `${base}/grow-branch-pool`, tag, method: "POST" })
    .input(z.object({ stepBytes: z.number().optional() }).optional())
    .output(
      z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), addedBytes: z.number(), imageMaxBytes: z.number() }),
        z.object({ ok: z.literal(false), reason: z.string() }),
      ]),
    ),
};
