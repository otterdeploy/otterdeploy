import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const builderStepSchema = z.object({
  __step: z.literal("builder"),
  ...kindFragment,
  ...nameFragment,
  builderId: z.string().min(1, "Select a builder"),
});
