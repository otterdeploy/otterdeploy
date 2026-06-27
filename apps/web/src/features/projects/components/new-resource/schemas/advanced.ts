import * as z from "zod";

import { kindFragment, nameFragment } from "./_base";

export const advancedStepSchema = z.object({
  __step: z.literal("advanced"),
  ...kindFragment,
  ...nameFragment,
});
