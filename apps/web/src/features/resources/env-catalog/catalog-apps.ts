/**
 * Env suggestions for application images the platform ships as templates.
 * Start of the collection: Autumn (the billing template). Each entry names
 * the upstream source and commit/version it was verified against — re-verify
 * when the template's image pin moves.
 */
import type { ImageEnvCatalogEntry } from "./types";

export const APP_ENV_CATALOG: ImageEnvCatalogEntry[] = [
  {
    // Our own build of github.com/useautumn/autumn (see templates-billing.ts).
    images: ["ghcr.io/dr34mw0rk5/autumn"],
    verifiedAgainst:
      "useautumn/autumn server/.env.example @ 7ed106c (the pinned image commit) + the template compose",
    vars: [
      {
        key: "AUTUMN_API_URL",
        description: "Public origin the API server is exposed on (scheme + host, no path).",
        required: true,
      },
      {
        key: "AUTUMN_PUBLIC_API_URL",
        description: "Public API origin handed to browser clients; usually equals AUTUMN_API_URL.",
      },
      {
        key: "CLIENT_URL",
        description: "Public origin the dashboard is exposed on.",
        required: true,
      },
      {
        key: "BETTER_AUTH_SECRET",
        description: "Signs dashboard auth sessions.",
        secret: true,
        required: true,
      },
      {
        key: "ENCRYPTION_IV",
        description: "Hex IV for encrypting stored Stripe keys.",
        secret: true,
        required: true,
      },
      {
        key: "ENCRYPTION_PASSWORD",
        description: "Key material for encrypting stored Stripe keys.",
        secret: true,
        required: true,
      },
      {
        key: "DATABASE_URL",
        description: "Postgres connection string.",
        secret: true,
        required: true,
      },
      {
        key: "CRITICAL_DATABASE_URL",
        description: "Postgres connection string for critical writes; defaults to DATABASE_URL.",
        secret: true,
      },
      { key: "REDIS_URL", description: "Redis/Valkey connection string for queues." },
      {
        key: "MISC_CACHE_DRAGONFLY_PUBLIC_URL",
        description: "Dragonfly connection string for the misc cache.",
      },
      {
        key: "CACHE_V2_DRAGONFLY_URL",
        description: "Dragonfly connection string for the v2 cache.",
      },
      {
        key: "DYNAMODB_ENDPOINT",
        description: "DynamoDB endpoint; point at the bundled dynamodb-local service.",
      },
      {
        key: "AWS_ACCESS_KEY_ID",
        description: "AWS key for DynamoDB; any value works against dynamodb-local.",
        secret: true,
        defaultValue: "local",
      },
      {
        key: "AWS_SECRET_ACCESS_KEY",
        description: "AWS secret for DynamoDB; any value works against dynamodb-local.",
        secret: true,
        defaultValue: "local",
      },
      {
        key: "SERVER_FORK_COUNT",
        description:
          "Bun cluster workers. Upstream defaults to 4, which OOMs small hosts; the template pins 1.",
        defaultValue: "1",
      },
      { key: "GOOGLE_CLIENT_ID", description: "Enables Google sign-in for the dashboard." },
      {
        key: "GOOGLE_CLIENT_SECRET",
        description: "Secret paired with GOOGLE_CLIENT_ID.",
        secret: true,
      },
      {
        key: "RESEND_API_KEY",
        description: "Enables transactional email (password resets, welcomes) via Resend.",
        secret: true,
      },
      { key: "RESEND_DOMAIN", description: "Sending domain for Resend email." },
      {
        key: "AXIOM_TOKEN",
        description: "Ships pino + OpenTelemetry logs to Axiom.",
        secret: true,
      },
      {
        key: "AXIOM_LOG_TRANSPORT",
        description: "Log transport; firelens only activates on ECS.",
        defaultValue: "direct",
      },
      {
        key: "SVIX_API_KEY",
        description: "Enables outbound webhooks via Svix.",
        secret: true,
      },
      {
        key: "SUPABASE_URL",
        description: "Supabase project URL, only when using Supabase-hosted Postgres.",
      },
      {
        key: "SUPABASE_SERVICE_KEY",
        description: "Supabase service-role key paired with SUPABASE_URL.",
        secret: true,
      },
      {
        key: "S3_CUSTOMER_EXPORTS_BUCKET",
        description: "S3 bucket for customer CSV exports; exports fail without it.",
      },
      { key: "S3_REGION", description: "AWS region for the exports bucket." },
      {
        key: "ANTHROPIC_API_KEY",
        description: "Used to generate singular/plural feature names in the dashboard.",
        secret: true,
      },
    ],
  },
];
