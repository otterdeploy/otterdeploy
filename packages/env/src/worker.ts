import { createEnv } from "@t3-oss/env-core";
import * as z from "zod/v4";

import { env as databaseEnv } from "./database";

export const env = createEnv({
  extends: [databaseEnv],
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    INNGEST_DEV: z.string().optional(),
    INNGEST_BASE_URL: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
