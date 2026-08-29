// Social publishing: scheduling a queue of posts out to the networks. See
// ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

/**
 * Temporal's dynamic config, carried verbatim from upstream's own
 * `dynamicconfig/development-sql.yaml`.
 *
 * This file and `SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES` are two halves of keeping
 * Postiz's boot-time search-attribute registration from killing the backend.
 *
 * Postiz registers two CUSTOM search attributes (`organizationId`, `postId`,
 * both Text) from `TemporalRegister.onModuleInit` on every backend boot: it
 * lists the namespace's attributes, diffs, and adds whatever is missing. With
 * `ENABLE_ES=false` visibility is the SQL store, whose schema has a FIXED
 * three reserved columns per type — and `auto-setup` spends two of the three
 * Text columns before Postiz ever connects, registering `CustomStringField`
 * and `CustomTextField` (demo scaffolding for its own tutorials, flagged
 * `add-custom-search-attributes-for-testing` and a standing TODO to delete
 * upstream). One free Text column, two wanted: every install failed with
 * "cannot have more than 3 search attribute of type Text", `onModuleInit`
 * threw, Nest never listened on 3000, and the bundled nginx answered every
 * /api call with 502 while the frontend kept serving normally — a stack that
 * looks healthy and cannot authenticate. `SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES`
 * declines the scaffolding and leaves all three columns for the app.
 *
 * `forceSearchAttributesCacheRefreshOnRead` closes the second half. Temporal's
 * frontend serves the attribute list from a cache, so a backend restarting
 * inside the refresh window reads a STALE list, believes both attributes are
 * still missing, and re-adds them — which now fails as "already exists"
 * instead, the same crash loop wearing a different message. Upstream mounts
 * this file for exactly that reason.
 *
 * Upstream also pairs the two with Elasticsearch, which removes the column
 * limit outright. That is a JVM and ~1 GB of RAM for a visibility surface
 * Postiz never queries (it starts and signals workflows; it never searches
 * them), so this stack keeps `ENABLE_ES=false` and fixes the cause instead.
 */
const TEMPORAL_DYNAMIC_CONFIG = `limit.maxIDLength:
  - value: 255
    constraints: {}
system.forceSearchAttributesCacheRefreshOnRead:
  - value: true
    constraints: {}
`;

export const SOCIAL_TEMPLATES: StackTemplate[] = [
  {
    id: "postiz",
    name: "Postiz",
    descriptionKey: "templates.catalog.postiz.description",
    category: "automation",
    includes: ["postiz", "db", "redis", "temporal"],
    requiredEnv: [
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
    files: [{ path: "dynamicconfig.yaml", content: TEMPORAL_DYNAMIC_CONFIG }],
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
     * Postiz never QUERIES that surface — but it does WRITE to it, registering
     * two custom search attributes at every boot, and SQL visibility caps each
     * type at three columns. That is why `SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES`
     * and the mounted dynamic config are not optional here; see
     * TEMPORAL_DYNAMIC_CONFIG for the whole failure.
     *
     * `RUN_CRON` registers the recurring "missing post" workflow at boot — the
     * sweep that republishes anything the scheduler dropped. On a single
     * instance it belongs on; running it on several would register it twice.
     *
     * `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY` carries no leading slash on
     * purpose: Postiz builds media URLs as `FRONTEND_URL + "/" + <this> +
     * path` (posts.service.ts), so a slash here produces a doubled one.
     *
     * The healthcheck goes THROUGH nginx to the backend (`/api/` on 5000 is
     * the backend's `GET /`, which answers "App is running!"), so it proves
     * the whole path a browser takes rather than that a process exists.
     * That distinction is load-bearing: the backend intermittently wedges at
     * boot — pm2 reports it online, it emits nothing, and never binds 3000
     * while the frontend serves normally. Without a healthcheck Swarm treats
     * the new task as healthy the instant the process starts and retires the
     * old one, so every wedge was an outage; with one it holds the previous
     * task until the new one actually answers. The 180s start_period covers
     * `prisma db push` plus the orchestrator compiling one ~3 MB workflow
     * bundle per provider queue (33 of them) before the backend gets CPU.
     * The image is bookworm-slim with neither curl nor wget, so the probe is
     * node's own fetch.
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
      MAIN_URL: \${{stack.postiz.PUBLIC_URL}}
      FRONTEND_URL: \${{stack.postiz.PUBLIC_URL}}
      NEXT_PUBLIC_BACKEND_URL: "\${{stack.postiz.PUBLIC_URL}}/api"
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
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:5000/api/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 180s
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
      SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES: "true"
      DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/development-sql.yaml
    volumes:
      - ./dynamicconfig.yaml:/etc/temporal/config/dynamicconfig/development-sql.yaml
    restart: always
volumes:
  postiz-config:
  postiz-uploads:
  postiz-db:
  postiz-redis:
`,
  },
];
