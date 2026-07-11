import * as z from "zod";

import {
  isValidHealthcheckPath,
  normalizeHealthcheckPath,
} from "@/features/resources/components/service/tabs/settings/healthcheck-http";

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
  // Empty = no container healthcheck. Non-empty must survive the same
  // path rule the generated wget||curl probe enforces (healthcheck-http.ts)
  // so the shell one-liner can never be broken by the input.
  healthPath: z
    .string()
    .refine((v) => v.trim() === "" || isValidHealthcheckPath(normalizeHealthcheckPath(v)), {
      message: "Health-check path contains characters the probe can't carry",
    }),
  healthInterval: z.number().int().min(1),
  healthTimeout: z.number().int().min(1),
  healthRetries: z.number().int().min(1).max(20),
  // Static-kind only: SPA index.html fallback. Ignored for other kinds.
  spa: z.boolean(),
});
