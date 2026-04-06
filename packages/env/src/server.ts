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
    CADDY_CONFIG_DIR: z.string().min(1).default("/etc/caddy"),
    CADDY_ADMIN_BIND: z.string().min(1).default("127.0.0.1:2019"),
    CADDY_RESERVED_HOSTS: z.string().default("web.otterstack.io,api.otterstack.io,localhost"),
    CADDY_RESERVED_LAYER4_PORTS: z.string().default("2019"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
