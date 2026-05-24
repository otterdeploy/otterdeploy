// Zod schema for the multi-step "create resource" wizard.
// Covers DB path (kind → version → resources → storage → advanced → review)
// and compute (app) path (kind → image → networking → resources → review).
import * as z from "zod";

const portSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().min(1),
  public: z.boolean(),
  host: z.string(),
});

export const resourceSchema = z.object({
  // Step: kind
  kindId: z.string().min(1, "Select a resource type"),

  // Step: version (DB) / shared
  name: z
    .string()
    .slugify()
    .min(2, "Name must be at least 2 characters")
    .max(48, "Name must be 48 characters or fewer"),
  version: z.string().nullable(),

  // Step: image (compute / custom)
  registry: z.string().min(1),
  image: z.string(),
  tag: z.string(),

  // Step: networking (app)
  ports: z.array(portSchema),
  healthPath: z.string(),
  healthInterval: z.number().int().min(1),

  // Step: resources
  presetId: z.string().min(1, "Select a size preset"),
  customCpu: z.number().min(0.1),
  customMem: z.number().min(128),
  replicas: z.number().int().min(1),
  placement: z.string().min(1),
  pinnedNodeId: z.string().nullable(),

  // Step: storage
  storageGb: z.number().int().min(1),
  backupsEnabled: z.boolean(),
  backupRetention: z.number().int().min(1).max(365),
  pitr: z.boolean(),
  highAvailability: z.boolean(),
});

export type ResourceFormValues = z.infer<typeof resourceSchema>;

export const resourceDefaults: ResourceFormValues = {
  kindId: "",
  name: "",
  version: null,
  registry: "docker",
  image: "ghcr.io/paperhouse/notify",
  tag: "latest",
  ports: [{ port: 3000, protocol: "http", public: true, host: "" }],
  healthPath: "/healthz",
  healthInterval: 10,
  presetId: "small",
  customCpu: 0.5,
  customMem: 512,
  replicas: 1,
  placement: "any",
  pinnedNodeId: null,
  storageGb: 20,
  backupsEnabled: false,
  backupRetention: 7,
  pitr: false,
  highAvailability: false,
};
