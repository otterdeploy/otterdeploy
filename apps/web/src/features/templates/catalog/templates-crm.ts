// CRM templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const CRM_TEMPLATES: StackTemplate[] = [
  {
    id: "twenty",
    name: "Twenty",
    descriptionKey: "templates.catalog.twenty.description",
    category: "crm",
    includes: ["twenty", "worker", "db", "redis"],
    requiredEnv: [
      {
        key: "SERVER_URL",
        descriptionKey: "templates.catalog.twenty.env.SERVER_URL",
      },
      {
        key: "APP_SECRET",
        descriptionKey: "templates.catalog.twenty.env.APP_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.twenty.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Twenty",
    docsUrl: "https://twenty.com/developers/section/self-hosting/docker-compose",
    compose: `name: twenty
services:
  twenty:
    image: twentycrm/twenty:v2.32.0
    depends_on:
      - db
      - redis
    environment:
      SERVER_URL: \${SERVER_URL}
      APP_SECRET: \${APP_SECRET}
      PG_DATABASE_URL: "postgres://postgres:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/default"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
      STORAGE_TYPE: local
      DISABLE_DB_MIGRATIONS: "false"
      DISABLE_CRON_JOBS_REGISTRATION: "false"
    ports:
      - "3000"
    volumes:
      - twenty-data:/app/packages/twenty-server/.local-storage
    restart: always
  worker:
    image: twentycrm/twenty:v2.32.0
    command: ["yarn", "worker:prod"]
    depends_on:
      - db
      - redis
    environment:
      SERVER_URL: \${SERVER_URL}
      APP_SECRET: \${APP_SECRET}
      PG_DATABASE_URL: "postgres://postgres:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/default"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
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
