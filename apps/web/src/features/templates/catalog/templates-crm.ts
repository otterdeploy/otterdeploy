// CRM templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const CRM_TEMPLATES: StackTemplate[] = [
  {
    id: "twenty",
    name: "Twenty",
    description:
      "Open-source CRM — a modern, keyboard-first alternative to Salesforce. App and background worker share a bundled Postgres and Redis; uploads persist to a named volume.",
    category: "crm",
    includes: ["twenty", "worker", "db", "redis"],
    requiredEnv: [
      {
        key: "SERVER_URL",
        description: "Public URL Twenty is served from — used for the API base and frontend links.",
      },
      {
        key: "APP_SECRET",
        description: "Secret used to sign sessions and tokens.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Superuser password for the bundled Postgres.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Twenty",
    docsUrl: "https://twenty.com/developers/section/self-hosting/docker-compose",
    compose: `name: twenty
services:
  twenty:
    image: twentycrm/twenty:v2.20.0
    depends_on:
      - db
      - redis
    environment:
      SERVER_URL: \${SERVER_URL}
      APP_SECRET: \${APP_SECRET}
      PG_DATABASE_URL: "postgres://postgres:\${POSTGRES_PASSWORD}@db:5432/default"
      REDIS_URL: "redis://redis:6379"
      STORAGE_TYPE: local
      DISABLE_DB_MIGRATIONS: "false"
      DISABLE_CRON_JOBS_REGISTRATION: "false"
    ports:
      - "3000"
    volumes:
      - twenty-data:/app/packages/twenty-server/.local-storage
    restart: always
  worker:
    image: twentycrm/twenty:v2.20.0
    command: ["yarn", "worker:prod"]
    depends_on:
      - db
      - redis
    environment:
      SERVER_URL: \${SERVER_URL}
      APP_SECRET: \${APP_SECRET}
      PG_DATABASE_URL: "postgres://postgres:\${POSTGRES_PASSWORD}@db:5432/default"
      REDIS_URL: "redis://redis:6379"
      DISABLE_DB_MIGRATIONS: "true"
      DISABLE_CRON_JOBS_REGISTRATION: "true"
    volumes:
      - twenty-data:/app/packages/twenty-server/.local-storage
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: default
    volumes:
      - twenty-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d default"]
      interval: 10s
      timeout: 5s
      retries: 10
    restart: always
  redis:
    image: redis:7-alpine
    restart: always
volumes:
  twenty-db:
  twenty-data:
`,
  },
];
