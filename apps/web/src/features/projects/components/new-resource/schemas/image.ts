import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const imageStepSchema = z.object({
  __step: z.literal("image"),
  ...kindFragment,
  ...nameFragment,
  registry: z.string().min(1),
  image: z.string().min(1, "Image required"),
  tag: z.string().min(1, "Tag required"),
});
