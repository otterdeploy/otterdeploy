import * as z from "zod";

import { kindFragment, nameFragment } from "./_base";

const varSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
});

export const variablesStepSchema = z.object({
  __step: z.literal("variables"),
  ...kindFragment,
  ...nameFragment,
  variables: z.array(varSchema),
  linkedSecrets: z.record(z.string(), z.boolean()),
});
