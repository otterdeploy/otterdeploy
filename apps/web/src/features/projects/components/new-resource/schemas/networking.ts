import * as z from "zod";

import {
  isValidHealthcheckPath,
  normalizeHealthcheckPath,
} from "@/features/resources/components/service/tabs/settings/healthcheck-http";

import { kindFragment, nameFragment } from "./_base";

const portSchema = z.object({
  // 0 = "not filled in yet" (renders as an empty input). Allowed for
  // internal-only rows — they're simply dropped at manifest build — but a
  // public row must name the container port its route forwards to.
  port: z.number().int().min(0).max(65535),
  protocol: z.string().min(1),
  public: z.boolean(),
  host: z.string(),
});

/** Shared by the networking + review arms so the same rule gates both:
 *  a row toggled Public needs a real container port for its route. */
export const portsListSchema = z.array(portSchema).superRefine((rows, ctx) => {
  rows.forEach((row, i) => {
    if (row.public && row.port < 1) {
      ctx.addIssue({
        code: "custom",
        message: "Enter the container port to publish",
        path: [i, "port"],
      });
    }
  });
});

export const networkingStepSchema = z.object({
  __step: z.literal("networking"),
  ...kindFragment,
  ...nameFragment,
  ports: portsListSchema,
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
