// Billing / monetization templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

// Upstream ships no container image, so we publish our own build of
// github.com/useautumn/autumn (Apache-2.0) at a pinned commit, built and
// pushed manually from infra/autumn/Dockerfile (see the notes there). The tag
// is the pinned upstream short sha; bump both together when upgrading.
const AUTUMN_IMAGE = "ghcr.io/dr34mw0rk5/autumn:sha-7ed106c";

export const BILLING_TEMPLATES: StackTemplate[] = [
  {
    id: "autumn",
    name: "Autumn",
    description:
      "Open-source pricing and billing layer over Stripe: model products and features once, then meter usage and gate access with attach / check / track calls. Runs the API server, queue workers, cron, and dashboard from one prebuilt image, with bundled Postgres, Valkey, Dragonfly and a DynamoDB emulator. Stripe keys are added per-org in the dashboard after deploy.",
    category: "devtools",
    includes: ["server", "workers", "cron", "dashboard", "db", "redis", "dragonfly", "dynamodb"],
    requiredEnv: [
      {
        key: "AUTUMN_API_URL",
        description:
          "Public origin the API server is exposed on (scheme + host only, no path). Expose the `server` service and use that URL.",
      },
      {
        key: "CLIENT_URL",
        description:
          "Public origin the dashboard is exposed on. Expose the `dashboard` service and use that URL.",
      },
      {
        key: "BETTER_AUTH_SECRET",
        description: "Signs dashboard auth sessions.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "ENCRYPTION_IV",
        description: "Hex IV for encrypting stored Stripe keys.",
        generateHint: "openssl rand -hex 16",
      },
      {
        key: "ENCRYPTION_PASSWORD",
        description: "Key material for encrypting stored Stripe keys.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Autumn",
    docsUrl: "https://github.com/useautumn/autumn#readme",
    compose: `name: autumn
services:
  server:
    image: ${AUTUMN_IMAGE}
    command:
      - sh
      - -c
      - bun /app/server/autumn-migrate.ts && exec bun start
    depends_on:
      - db
      - redis
      - dragonfly
      - dynamodb
    environment:
      AUTUMN_API_URL: \${AUTUMN_API_URL}
      CLIENT_URL: \${CLIENT_URL}
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET}
      ENCRYPTION_IV: \${ENCRYPTION_IV}
      ENCRYPTION_PASSWORD: \${ENCRYPTION_PASSWORD}
      DATABASE_URL: "postgres://autumn:\${POSTGRES_PASSWORD}@db:5432/autumn"
      REDIS_URL: "redis://redis:6379"
      MISC_CACHE_DRAGONFLY_PUBLIC_URL: "redis://dragonfly:6379"
      CACHE_V2_DRAGONFLY_URL: "redis://dragonfly:6379"
      DYNAMODB_ENDPOINT: "http://dynamodb:8000"
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
    ports:
      - "8080"
    restart: always
  workers:
    image: ${AUTUMN_IMAGE}
    command:
      - bun
      - src/workers.ts
    depends_on:
      - db
      - redis
      - dragonfly
    environment:
      AUTUMN_API_URL: \${AUTUMN_API_URL}
      CLIENT_URL: \${CLIENT_URL}
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET}
      ENCRYPTION_IV: \${ENCRYPTION_IV}
      ENCRYPTION_PASSWORD: \${ENCRYPTION_PASSWORD}
      DATABASE_URL: "postgres://autumn:\${POSTGRES_PASSWORD}@db:5432/autumn"
      REDIS_URL: "redis://redis:6379"
      MISC_CACHE_DRAGONFLY_PUBLIC_URL: "redis://dragonfly:6379"
      CACHE_V2_DRAGONFLY_URL: "redis://dragonfly:6379"
      DYNAMODB_ENDPOINT: "http://dynamodb:8000"
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
    restart: always
  cron:
    image: ${AUTUMN_IMAGE}
    command:
      - bun
      - src/cron.ts
    depends_on:
      - db
      - redis
      - dragonfly
    environment:
      AUTUMN_API_URL: \${AUTUMN_API_URL}
      CLIENT_URL: \${CLIENT_URL}
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET}
      ENCRYPTION_IV: \${ENCRYPTION_IV}
      ENCRYPTION_PASSWORD: \${ENCRYPTION_PASSWORD}
      DATABASE_URL: "postgres://autumn:\${POSTGRES_PASSWORD}@db:5432/autumn"
      REDIS_URL: "redis://redis:6379"
      MISC_CACHE_DRAGONFLY_PUBLIC_URL: "redis://dragonfly:6379"
      CACHE_V2_DRAGONFLY_URL: "redis://dragonfly:6379"
    restart: always
  dashboard:
    image: ${AUTUMN_IMAGE}
    # The dist ships prebuilt against sentinel origins; rewrite them to this
    # deployment's URLs in a copy (idempotent across restarts), then serve.
    command:
      - sh
      - -c
      - >-
        cp -r /app/vite/dist /tmp/dist &&
        find /tmp/dist -type f \\( -name '*.js' -o -name '*.html' -o -name '*.css' \\)
        -exec sed -i "s|http://__AUTUMN_API_URL__|\$AUTUMN_API_URL|g;
        s|http://__AUTUMN_CLIENT_URL__|\$CLIENT_URL|g" {} + &&
        bun /app/vite/serve-dist.ts /tmp/dist
    environment:
      AUTUMN_API_URL: \${AUTUMN_API_URL}
      CLIENT_URL: \${CLIENT_URL}
    ports:
      - "3000"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: autumn
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: autumn
    volumes:
      - autumn-db:/var/lib/postgresql/data
    restart: always
  redis:
    image: valkey/valkey:8-alpine
    volumes:
      - autumn-redis:/data
    restart: always
  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly:v1.27.2
    volumes:
      - autumn-dragonfly:/data
    restart: always
  dynamodb:
    image: amazon/dynamodb-local:2.5.2
    command:
      - -jar
      - DynamoDBLocal.jar
      - -inMemory
      - -sharedDb
    restart: always
volumes:
  autumn-db:
  autumn-redis:
  autumn-dragonfly:
`,
  },
];
