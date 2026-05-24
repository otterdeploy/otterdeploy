// Zod schema for the multi-step "create resource" wizard.
// Pass B scope: database path only (kind → version → resources → storage → advanced → review).
import * as z from "zod";

export const resourceSchema = z.object({
  // Step: kind
  kindId: z.string().min(1, "Select a resource type"),

  // Step: version
  name: z
    .string()
    .slugify()
    .min(2, "Name must be at least 2 characters")
    .max(48, "Name must be 48 characters or fewer"),
  version: z.string().nullable(),

  // Step: resources
  presetId: z.string().min(1, "Select a size preset"),
  customCpu: z.number().min(0.1),
  customMem: z.number().min(128),
  replicas: z.number().int().min(1),
  placement: z.string().min(1),

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
  presetId: "small",
  customCpu: 0.5,
  customMem: 512,
  replicas: 1,
  placement: "any",
  storageGb: 20,
  backupsEnabled: false,
  backupRetention: 7,
  pitr: false,
  highAvailability: false,
};
