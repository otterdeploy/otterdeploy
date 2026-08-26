// Social publishing: scheduling a queue of posts out to the networks. See
// ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const SOCIAL_TEMPLATES: StackTemplate[] = [
  {
    id: "postiz",
    name: "Postiz",
    descriptionKey: "templates.catalog.postiz.description",
    category: "automation",
    includes: ["postiz", "db", "redis", "temporal"],
    requiredEnv: [
      { key: "POSTIZ_URL", descriptionKey: "templates.catalog.postiz.env.POSTIZ_URL" },
      {
        key: "JWT_SECRET",
        descriptionKey: "templates.catalog.postiz.env.JWT_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.postiz.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Postiz",
    docsUrl: "https://docs.postiz.com/installation/docker-compose",
    /*
     * One container running the whole app under pm2, with nginx in front of it
     * on 5000: `/api` to the NestJS backend (3000), `/uploads` straight off
     * disk, everything else to the Next.js frontend (4200). That is why 5000
     * is the only published port and why `NEXT_PUBLIC_BACKEND_URL` is the
     * public URL plus `/api` rather than a second hostname — one origin serves
     * both, and nginx strips the prefix (var/docker/nginx.conf). The same
     * start command runs `prisma db push` first, so the schema is created on
     * the first boot and no migration step is left to the operator.
     *
     * Temporal is not optional. Since v2.12 Postiz schedules every post
     * through it (`temporal.module.ts` connects to TEMPORAL_ADDRESS, falling
     * back to `localhost:7233`), so without a server here the app boots, the
     * calendar renders, and nothing it schedules ever publishes.
     *
     * Upstream's compose gives Temporal a Postgres of its own plus an
     * Elasticsearch. Neither is carried here. `auto-setup` creates its
     * `temporal` and `temporal_visibility` databases on whatever server
     * POSTGRES_SEEDS names, and the bundled Postgres' own user is a superuser,
     * so one instance holds both Postiz's schema and Temporal's — separate
     * databases, one process to back up. Elasticsearch buys Temporal's
     * advanced-visibility search over workflow history: with `ENABLE_ES=false`
     * (auto-setup's own default) visibility lands in SQL instead, which is
     * supported and is a JVM and ~1 GB of RAM the operator does not pay for.
     * Postiz never queries that surface; it starts and signals workflows.
     *
     * `RUN_CRON` registers the recurring "missing post" workflow at boot — the
     * sweep that republishes anything the scheduler dropped. On a single
     * instance it belongs on; running it on several would register it twice.
     *
     * `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY` carries no leading slash on
     * purpose: Postiz builds media URLs as `FRONTEND_URL + "/" + <this> +
     * path` (posts.service.ts), so a slash here produces a doubled one.
     */
    compose: `name: postiz
services:
  postiz:
    image: ghcr.io/gitroomhq/postiz-app:v2.23.0
    depends_on:
      - db
      - redis
      - temporal
    environment:
      MAIN_URL: \${POSTIZ_URL}
      FRONTEND_URL: \${POSTIZ_URL}
      NEXT_PUBLIC_BACKEND_URL: "\${POSTIZ_URL}/api"
      BACKEND_INTERNAL_URL: "http://localhost:3000"
      JWT_SECRET: \${JWT_SECRET}
      DATABASE_URL: "postgresql://postiz:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/postiz"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
      TEMPORAL_ADDRESS: "\${{stack.temporal.HOST}}:7233"
      IS_GENERAL: "true"
      DISABLE_REGISTRATION: "false"
      RUN_CRON: "true"
      STORAGE_PROVIDER: local
      UPLOAD_DIRECTORY: /uploads
      NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: uploads
    ports:
      - "5000"
    volumes:
      - postiz-config:/config
      - postiz-uploads:/uploads
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postiz
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: postiz
    volumes:
      - postiz-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postiz"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  redis:
    image: redis:7.2-alpine
    volumes:
      - postiz-redis:/data
    restart: always
  temporal:
    image: temporalio/auto-setup:1.28.1
    depends_on:
      - db
    environment:
      DB: postgres12
      DB_PORT: "5432"
      POSTGRES_SEEDS: "\${{stack.db.HOST}}"
      POSTGRES_USER: postiz
      POSTGRES_PWD: \${POSTGRES_PASSWORD}
      ENABLE_ES: "false"
      TEMPORAL_NAMESPACE: default
    restart: always
volumes:
  postiz-config:
  postiz-uploads:
  postiz-db:
  postiz-redis:
`,
  },
];
