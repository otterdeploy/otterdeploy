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

    // GitHub App — source for git-backed deploys. All optional in dev (the
    // providers page surfaces a "not configured" state); required at
    // runtime only when an operator actually connects an account.
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
    // PEM-encoded RSA private key. Pasted as a single string with literal
    // "\n" sequences (env var conventions); we convert at use time.
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** Slug of the App (e.g. "otterstack-deploy"). Used to build the
     *  install URL `https://github.com/apps/<slug>/installations/new`. */
    GITHUB_APP_SLUG: z.string().min(1).optional(),

    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
