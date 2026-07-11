import * as z from "zod";

import { kindFragment, nameFragment } from "./_base";

/**
 * The storage step is informational-only: the database provisioner creates a
 * plain named Docker volume with no sizing/backup/PITR/HA options (see the
 * step component), so this schema deliberately carries no storage fields —
 * requiring values the backend drops would be validating fiction.
 */
export const storageStepSchema = z.object({
  __step: z.literal("storage"),
  ...kindFragment,
  ...nameFragment,
});
