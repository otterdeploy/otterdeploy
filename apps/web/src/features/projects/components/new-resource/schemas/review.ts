import * as z from "zod";

import { kindFragment, nameFragment } from "./_base";

const portSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().min(1),
  public: z.boolean(),
  host: z.string(),
});

const varSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
});

export const reviewStepSchema = z.object({
  __step: z.literal("review"),
  ...kindFragment,
  ...nameFragment,
  version: z.string().nullable(),
  src: z.enum(["github", "gitlab"]),
  repo: z.string(),
  branch: z.string(),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
  builderId: z.string(),
  registry: z.string(),
  image: z.string(),
  tag: z.string(),
  ports: z.array(portSchema),
  healthPath: z.string(),
  healthInterval: z.number().int().min(1),
  healthTimeout: z.number().int().min(1),
  healthRetries: z.number().int().min(1),
  variables: z.array(varSchema),
  linkedSecrets: z.record(z.string(), z.boolean()),
  presetId: z.string().min(1),
  customCpu: z.number().min(0.1),
  customMem: z.number().min(128),
  replicas: z.number().int().min(1),
  placement: z.string().min(1),
  pinnedNodeId: z.string().nullable(),
  // No storage/backup/PITR/HA fields: the manifest databaseSchema and the
  // DB provisioner support none of them (see schemas/storage.ts) —
  // validating fields the backend drops would be validating fiction.
});
