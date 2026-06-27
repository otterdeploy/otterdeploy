import * as z from "zod";

import { kindFragment, nameFragment } from "./_base";

export const resourcesStepSchema = z.object({
  __step: z.literal("resources"),
  ...kindFragment,
  ...nameFragment,
  presetId: z.string().min(1, "Select a size preset"),
  customCpu: z.number().min(0.1),
  customMem: z.number().min(128),
  replicas: z.number().int().min(1),
  placement: z.string().min(1),
  pinnedNodeId: z.string().nullable(),
});
