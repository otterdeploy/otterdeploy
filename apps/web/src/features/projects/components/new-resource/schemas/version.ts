import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const versionStepSchema = z.object({
  __step: z.literal("version"),
  ...kindFragment,
  ...nameFragment,
  version: z.string().min(1, "Pick a version"),
});
