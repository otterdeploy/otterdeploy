import { createEnv } from "@t3-oss/env-core";
import { upstashRedis } from "@t3-oss/env-core/presets-zod";
import * as z from "zod";

export const env = createEnv({
  extends: [upstashRedis()],
  server: {
    DATABASE_URL: z.string().min(1),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),

    POLAR_SUCCESS_URL: z.url(),
    POLAR_ACCESS_TOKEN: z.string().min(1),

    CORS_ORIGIN: z.url(),

    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email().default("onboarding@resend.dev"),

    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    CADDY_ADMIN_URL: z.url().default("http://127.0.0.1:2019"),
    CADDY_ADMIN_BIND: z.string().min(1).default("0.0.0.0:2019"),
    DATABASE_PROVISIONER_URL: z.string().min(1).optional(),
    DATABASE_PUBLIC_BASE_DOMAIN: z.string().min(1).default("db.otterstack.dev"),
    DATABASE_INTERNAL_BASE_DOMAIN: z.string().min(1).default("otterstack.internal"),
    DATABASE_PUBLIC_PORT: z.coerce.number().int().positive().default(443),
    DATABASE_INTERNAL_PORT: z.coerce.number().int().positive().default(5432),
    DATABASE_PUBLIC_UPSTREAM_HOST: z.string().min(1).default("otterstack-postgres"),
    DATABASE_PUBLIC_UPSTREAM_PORT: z.coerce.number().int().positive().default(5432),
    DATABASE_LOCAL_HOST: z.string().min(1).default("127.0.0.1"),
    DOCKER_RESOURCE_NETWORK: z.string().min(1).default("otterstack-resources"),
    DOCKER_POSTGRES_IMAGE: z.string().min(1).default("postgres:18-alpine"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
