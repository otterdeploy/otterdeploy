// Status-page + synthetic-monitoring templates. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

/**
 * Every image here floats on `latest`, which is deliberate and not laziness:
 * openstatus publishes no semver tags at all. The only other tags on
 * `ghcr.io/openstatushq/*` are the commit SHAs of the build that produced
 * them, and they do NOT line up across images — `openstatus-db-migrate` only
 * rebuilds when `packages/db` changes, so its newest SHA is always a different
 * commit from the dashboard's. Pinning would therefore mean pairing a
 * migration set with app images from an unrelated commit. `latest` is the one
 * tag that is coherent across the set: every image's `latest` is built from
 * the same `main`.
 */
export const STATUS_TEMPLATES: StackTemplate[] = [
  {
    id: "openstatus",
    name: "openstatus",
    descriptionKey: "templates.catalog.openstatus.description",
    category: "observability",
    includes: [
      "libsql",
      "tinybird",
      "db-migrate",
      "workflows",
      "server",
      "private-location",
      "dashboard",
      "status-page",
    ],
    requiredEnv: [
      {
        key: "AUTH_SECRET",
        descriptionKey: "templates.catalog.openstatus.env.AUTH_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "CRON_SECRET",
        descriptionKey: "templates.catalog.openstatus.env.CRON_SECRET",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "RESEND_API_KEY",
        descriptionKey: "templates.catalog.openstatus.env.RESEND_API_KEY",
      },
    ],
    logoBrand: "openstatus",
    docsUrl: "https://www.openstatus.dev/docs/guides/self-hosting-openstatus",
    // `db-migrate` is a one-shot: it applies the drizzle migrations and exits,
    // so it carries `restart: "no"` rather than the stack's usual `always`.
    // Same shape as the AFFiNE template's `affine_migration`. It is idempotent
    // — drizzle records what it applied in `__drizzle_migrations` — so a
    // redeploy re-runs it harmlessly.
    //
    // TINY_BIRD_API_KEY / TINYBIRD_TOKEN are the same token under two names
    // (the Node apps read the first, the Go ingest server the second) and both
    // carry an empty default rather than being prompted for: the token does
    // not EXIST until `tb --local deploy` has run against the Tinybird
    // container this stack starts, which is after install. Set them from the
    // stack's Variables tab once you have it. Until then the apps run and
    // every chart is empty.
    compose: `name: openstatus
services:
  libsql:
    image: ghcr.io/tursodatabase/libsql-server:latest
    environment:
      SQLD_NODE: primary
      SQLD_MAX_CONCURRENT_CONNECTIONS: "512"
      SQLD_MAX_CONCURRENT_REQUESTS: "1024"
    ports:
      - "8080"
      - "5001"
    volumes:
      - openstatus-libsql:/var/lib/sqld
    restart: always
  tinybird:
    image: tinybirdco/tinybird-local:latest
    environment:
      COMPATIBILITY_MODE: "1"
    ports:
      - "7181"
    volumes:
      - openstatus-clickhouse:/var/lib/clickhouse
      - openstatus-tinybird-redis:/redis-data
    restart: always
  db-migrate:
    image: ghcr.io/openstatushq/openstatus-db-migrate:latest
    depends_on:
      - libsql
    environment:
      DATABASE_URL: "http://\${{stack.libsql.HOST}}:8080"
    restart: "no"
  workflows:
    image: ghcr.io/openstatushq/openstatus-workflows:latest
    depends_on:
      - db-migrate
      - libsql
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: "http://\${{stack.libsql.HOST}}:8080"
      CRON_SECRET: \${CRON_SECRET}
      RESEND_API_KEY: \${RESEND_API_KEY}
      TINYBIRD_URL: "http://\${{stack.tinybird.HOST}}:7181"
      TINY_BIRD_API_KEY: \${TINY_BIRD_API_KEY:-}
    ports:
      - "3000"
    volumes:
      - openstatus-workflows:/app/data
    restart: always
  server:
    image: ghcr.io/openstatushq/openstatus-server:latest
    depends_on:
      - db-migrate
      - libsql
      - workflows
    environment:
      NODE_ENV: production
      PORT: "3000"
      SELF_HOST: "true"
      FLY_REGION: self-hosted
      DATABASE_URL: "http://\${{stack.libsql.HOST}}:8080"
      CRON_SECRET: \${CRON_SECRET}
      RESEND_API_KEY: \${RESEND_API_KEY}
      TINYBIRD_URL: "http://\${{stack.tinybird.HOST}}:7181"
      TINY_BIRD_API_KEY: \${TINY_BIRD_API_KEY:-}
    ports:
      - "3000"
    restart: always
  private-location:
    image: ghcr.io/openstatushq/openstatus-private-location:latest
    depends_on:
      - server
    environment:
      GIN_MODE: release
      PORT: "8080"
      DB_URL: "http://\${{stack.libsql.HOST}}:8080"
      WORKFLOWS_URL: "http://\${{stack.workflows.HOST}}:3000"
      CRON_SECRET: \${CRON_SECRET}
      TINYBIRD_URL: "http://\${{stack.tinybird.HOST}}:7181"
      TINYBIRD_TOKEN: \${TINYBIRD_TOKEN:-}
    ports:
      - "8080"
    restart: always
  dashboard:
    image: ghcr.io/openstatushq/openstatus-dashboard:latest
    depends_on:
      - db-migrate
      - libsql
      - server
      - workflows
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: 0.0.0.0
      AUTH_TRUST_HOST: "true"
      AUTH_SECRET: \${AUTH_SECRET}
      SELF_HOST: "true"
      DATABASE_URL: "http://\${{stack.libsql.HOST}}:8080"
      CRON_SECRET: \${CRON_SECRET}
      RESEND_API_KEY: \${RESEND_API_KEY}
      TINYBIRD_URL: "http://\${{stack.tinybird.HOST}}:7181"
      TINY_BIRD_API_KEY: \${TINY_BIRD_API_KEY:-}
    ports:
      - "3000"
    restart: always
  status-page:
    image: ghcr.io/openstatushq/openstatus-status-page:latest
    depends_on:
      - db-migrate
      - libsql
      - server
      - workflows
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: 0.0.0.0
      AUTH_TRUST_HOST: "true"
      AUTH_SECRET: \${AUTH_SECRET}
      SELF_HOST: "true"
      DATABASE_URL: "http://\${{stack.libsql.HOST}}:8080"
      CRON_SECRET: \${CRON_SECRET}
      RESEND_API_KEY: \${RESEND_API_KEY}
      TINYBIRD_URL: "http://\${{stack.tinybird.HOST}}:7181"
      TINY_BIRD_API_KEY: \${TINY_BIRD_API_KEY:-}
      OPENSTATUS_API_URL: "http://\${{stack.server.HOST}}:3000"
    ports:
      - "3000"
    restart: always
volumes:
  openstatus-libsql:
  openstatus-clickhouse:
  openstatus-tinybird-redis:
  openstatus-workflows:
`,
  },
];
