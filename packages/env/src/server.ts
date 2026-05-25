import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_PROVISIONER_URL: z.string().min(1).optional(),

    REDIS_URL: z.string().min(1),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),

    CORS_ORIGIN: z.url(),

    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email().default("onboarding@resend.dev"),

    CADDY_ADMIN_URL: z.url().default("http://127.0.0.1:2019"),
    CADDY_ADMIN_BIND: z.string().min(1).default("0.0.0.0:2019"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
