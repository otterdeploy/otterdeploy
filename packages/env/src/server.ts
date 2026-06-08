import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_PROVISIONER_URL: z.string().min(1).optional(),

    REDIS_URL: z.string().min(1),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),

    CORS_ORIGIN: z
      .string()
      .transform((data) => data.split(",").map((s) => s.trim()))
      .pipe(z.array(z.url())),

    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email().default("onboarding@resend.dev"),

    CADDY_ADMIN_URL: z.url().default("http://127.0.0.1:2019"),
    CADDY_ADMIN_BIND: z.string().min(1).default("0.0.0.0:2019"),

    // GitHub Apps are created through the manifest flow (UI button in
    // Settings → Git Providers). App ID, client secret, webhook secret,
    // PEM private key, and slug all live on the `git_provider` row
    // (secrets encrypted at rest via packages/api/src/lib/crypto.ts) —
    // no env vars for any of it. Matches how Coolify and Dokploy
    // configure GitHub Apps.

    // Build pipeline — apps/builder. Concurrency is how many deploy
    // jobs the builder pulls from the queue at once; default 1 keeps
    // docker builds from contending on the daemon.
    BUILDER_CONCURRENCY: z.coerce.number().int().positive().default(1),

    // Basic-auth creds for the Workbench BullMQ dashboard (/jobs on the
    // server). Both must be set for the dashboard to mount — it can
    // retry/remove jobs, so it never runs unauthenticated.
    WORKBENCH_USER: z.string().min(1).optional(),
    WORKBENCH_PASS: z.string().min(1).optional(),

    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
