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

export const systemContract = {
  version: oc
    .meta({ path: `${base}/version`, tag, method: "GET" })
    .input(emptyInput)
    .output(versionInfoSchema),

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
};
