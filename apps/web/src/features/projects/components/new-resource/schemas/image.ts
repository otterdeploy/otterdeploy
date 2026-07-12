import * as z from "zod";

import { kindFragment, nameFragment } from "./_base";

export const imageStepSchema = z.object({
  __step: z.literal("image"),
  ...kindFragment,
  ...nameFragment,
  // Stored container_registry id, or "" for anonymous pull (public images).
  // Pull credentials are matched by the image's HOST at deploy time
  // (resolveRegistryAuth) — this pick drives the tag browser's auth and
  // the operator's intent, so empty is a fully valid choice.
  registry: z.string(),
  image: z.string().min(1, "Image required"),
  tag: z.string().min(1, "Tag required"),
});
