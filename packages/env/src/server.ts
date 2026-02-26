import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { env as databaseEnv } from "./database";

export const env = createEnv({
  extends: [databaseEnv],
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    INFISICAL_GATEWAY_URL: z.url().optional(),
    INFISICAL_GATEWAY_TOKEN: z.string().min(1).optional(),
    INFISICAL_MACHINE_IDENTITY_CLIENT_ID: z.string().min(1).optional(),
    INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET: z.string().min(1).optional(),
    INFISICAL_PROJECT_PREFIX: z.string().min(1).optional(),
    SECRET_PROVIDER: z.enum(["infisical", "native_breakglass"]).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
