import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const storageStepSchema = z.object({
  __step: z.literal("storage"),
  ...kindFragment,
  ...nameFragment,
  storageGb: z.number().int().min(1),
  backupsEnabled: z.boolean(),
  backupRetention: z.number().int().min(1).max(365),
  pitr: z.boolean(),
  highAvailability: z.boolean(),
});
