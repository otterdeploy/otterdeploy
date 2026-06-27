import * as z from "zod";

import { kindFragment } from "./_base";

export const kindStepSchema = z.object({
  __step: z.literal("kind"),
  ...kindFragment,
});
