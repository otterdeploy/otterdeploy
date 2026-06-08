import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

const portSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().min(1),
  public: z.boolean(),
  host: z.string(),
});

export const networkingStepSchema = z.object({
  __step: z.literal("networking"),
  ...kindFragment,
  ...nameFragment,
  ports: z.array(portSchema),
  healthPath: z.string(),
  healthInterval: z.number().int().min(1),
  // Static-kind only: SPA index.html fallback. Ignored for other kinds.
  spa: z.boolean(),
});
