// Internal-tool builders: point them at a database and drag out an admin
// panel. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const LOWCODE_TEMPLATES: StackTemplate[] = [
  {
    id: "appsmith",
    name: "Appsmith",
    descriptionKey: "templates.catalog.appsmith.description",
    category: "lowcode",
    includes: ["appsmith"],
    requiredEnv: [
      {
        key: "APPSMITH_ENCRYPTION_PASSWORD",
        descriptionKey: "templates.catalog.appsmith.env.APPSMITH_ENCRYPTION_PASSWORD",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "APPSMITH_ENCRYPTION_SALT",
        descriptionKey: "templates.catalog.appsmith.env.APPSMITH_ENCRYPTION_SALT",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Appsmith",
    docsUrl: "https://docs.appsmith.com/getting-started/setup/installation-guides/docker",
    // v2.3 (2026-08-13) is an EXACT release, not a floating minor: Appsmith
    // publishes `vMAJOR.MINOR` tags and ships hotfixes as their own `vX.Y.Z`
    // tag (v1.98.1 did not re-push v1.98). It shares its digest with `latest`.
    // The community image is a full stack in one container (app, MongoDB,
    // Redis, an embedded Postgres for mock datasources, Caddy) under
    // /appsmith-stacks, so the volume IS the install: lose it and every app,
    // datasource and credential goes with it.
    compose: `name: appsmith
services:
  appsmith:
    image: appsmith/appsmith-ce:v2.3
    environment:
      APPSMITH_ENCRYPTION_PASSWORD: \${APPSMITH_ENCRYPTION_PASSWORD}
      APPSMITH_ENCRYPTION_SALT: \${APPSMITH_ENCRYPTION_SALT}
      APPSMITH_DISABLE_TELEMETRY: "true"
    ports:
      - "80"
    volumes:
      - appsmith-stacks:/appsmith-stacks
    restart: always
volumes:
  appsmith-stacks:
`,
  },
  {
    id: "tooljet",
    name: "ToolJet",
    descriptionKey: "templates.catalog.tooljet.description",
    category: "lowcode",
    includes: ["tooljet", "postgrest", "db"],
    requiredEnv: [
      { key: "TOOLJET_HOST", descriptionKey: "templates.catalog.tooljet.env.TOOLJET_HOST" },
      {
        key: "LOCKBOX_MASTER_KEY",
        descriptionKey: "templates.catalog.tooljet.env.LOCKBOX_MASTER_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "SECRET_KEY_BASE",
        descriptionKey: "templates.catalog.tooljet.env.SECRET_KEY_BASE",
        generateHint: "openssl rand -hex 64",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.tooljet.env.POSTGRES_PASSWORD",
        // hex, NOT base64: this value is interpolated into PGRST_DB_URI's
        // userinfo, and a "/" out of the base64 alphabet ends the userinfo
        // early so libpq parses the rest of the password as the host.
        generateHint: "openssl rand -hex 24",
      },
      {
        key: "PGRST_JWT_SECRET",
        descriptionKey: "templates.catalog.tooljet.env.PGRST_JWT_SECRET",
        generateHint: "openssl rand -hex 32",
      },
    ],
    logoBrand: "ToolJet",
    docsUrl: "https://docs.tooljet.ai/docs/setup/docker",
    // `tooljet/tooljet` is the ENTERPRISE build (the community one lives at
    // `tooljet/tooljet-ce`); both share the same LTS tag stream and the EE
    // image runs unlicensed on the free tier, so this stays on EE. Pinned off
    // `ee-lts-latest`, which floats fast — it was v3.20.222-lts (pushed
    // 2026-09-03) at research time, one day old; v3.20.218-lts is the matured
    // sibling and no open advisory reaches past 3.20.180.
    // The EE image's final stage is a bare debian with no CMD, so `command:`
    // is load-bearing: without it the entrypoint execs `bash` and the
    // container exits. PORT must be set because the server otherwise listens
    // on 3000. And boot-time database validation
    // (server/scripts/database-config-utils.ts) makes TOOLJET_DB_USER a hard
    // Joi requirement with no fallback — omit it and `db:create:prod` throws
    // before the app ever starts.
    // The ToolJet Database (the built-in table editor) is served by PostgREST,
    // which the EE image bakes in at v12.2.0 but only launches in-container
    // when PGRST_HOST starts with "localhost:" — and then as an unsupervised
    // background process the entrypoint never restarts. It runs as its own
    // service here instead, on the version ToolJet targets. It crash-loops
    // until the tooljet service has created tooljet_db and installed the
    // postgrest.pre_config function on first boot; `restart: always` is what
    // carries it across that gap, so tooljet deliberately does NOT depend_on
    // it. PGRST_JWT_SECRET is shared: tooljet mints the HS256 token
    // (postgrest-proxy.service.ts), PostgREST verifies it.
    compose: `name: tooljet
services:
  tooljet:
    image: tooljet/tooljet:v3.20.218-lts
    depends_on:
      - db
    command: npm run start:prod
    environment:
      TOOLJET_HOST: \${TOOLJET_HOST}
      LOCKBOX_MASTER_KEY: \${LOCKBOX_MASTER_KEY}
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      PORT: "80"
      SERVE_CLIENT: "true"
      PG_HOST: "\${{stack.db.HOST}}"
      PG_PORT: "5432"
      PG_DB: tooljet
      PG_USER: tooljet
      PG_PASS: \${POSTGRES_PASSWORD}
      TOOLJET_DB: tooljet_db
      TOOLJET_DB_HOST: "\${{stack.db.HOST}}"
      TOOLJET_DB_PORT: "5432"
      TOOLJET_DB_USER: tooljet
      TOOLJET_DB_PASS: \${POSTGRES_PASSWORD}
      PGRST_HOST: "http://\${{stack.postgrest.HOST}}:3000"
      PGRST_JWT_SECRET: \${PGRST_JWT_SECRET}
      DEPLOYMENT_PLATFORM: docker
    ports:
      - "80"
    restart: always
  postgrest:
    image: postgrest/postgrest:v12.2.0
    depends_on:
      - db
    environment:
      PGRST_DB_URI: postgres://tooljet:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/tooljet_db
      PGRST_DB_PRE_CONFIG: postgrest.pre_config
      PGRST_JWT_SECRET: \${PGRST_JWT_SECRET}
      PGRST_SERVER_PORT: "3000"
      PGRST_LOG_LEVEL: info
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tooljet
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: tooljet
    volumes:
      - tooljet-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tooljet"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  tooljet-db:
`,
  },
  {
    id: "budibase",
    name: "Budibase",
    descriptionKey: "templates.catalog.budibase.description",
    category: "lowcode",
    includes: ["budibase"],
    requiredEnv: [
      {
        key: "JWT_SECRET",
        descriptionKey: "templates.catalog.budibase.env.JWT_SECRET",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "INTERNAL_API_KEY",
        descriptionKey: "templates.catalog.budibase.env.INTERNAL_API_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "MINIO_ACCESS_KEY",
        descriptionKey: "templates.catalog.budibase.env.MINIO_ACCESS_KEY",
        generateHint: "openssl rand -hex 16",
      },
      {
        key: "MINIO_SECRET_KEY",
        descriptionKey: "templates.catalog.budibase.env.MINIO_SECRET_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "REDIS_PASSWORD",
        descriptionKey: "templates.catalog.budibase.env.REDIS_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "COUCHDB_PASSWORD",
        descriptionKey: "templates.catalog.budibase.env.COUCHDB_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Budibase",
    docsUrl: "https://docs.budibase.com/docs/docker",
    // The all-in-one image bundles CouchDB, Redis, MinIO and (since 3.4x) a
    // LiteLLM proxy with its own Postgres, so the secrets below are what it
    // uses to talk to its OWN internals. It generates any of them left unset
    // and persists them to /data/.env; supplying them here keeps them known
    // to you and stable across a rebuild.
    compose: `name: budibase
services:
  budibase:
    image: budibase/budibase:v3.44.0
    environment:
      JWT_SECRET: \${JWT_SECRET}
      INTERNAL_API_KEY: \${INTERNAL_API_KEY}
      MINIO_ACCESS_KEY: \${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: \${MINIO_SECRET_KEY}
      REDIS_PASSWORD: \${REDIS_PASSWORD}
      COUCHDB_USER: budibase
      COUCHDB_PASSWORD: \${COUCHDB_PASSWORD}
    ports:
      - "80"
    volumes:
      - budibase-data:/data
    restart: always
volumes:
  budibase-data:
`,
  },
  {
    id: "nocobase",
    name: "NocoBase",
    descriptionKey: "templates.catalog.nocobase.description",
    category: "lowcode",
    includes: ["nocobase", "db"],
    requiredEnv: [
      {
        key: "APP_KEY",
        descriptionKey: "templates.catalog.nocobase.env.APP_KEY",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.nocobase.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "NocoBase",
    docsUrl: "https://docs.nocobase.com/get-started/installation/docker",
    // Bumped from 1.6.15 (pushed 2025-04-01): the whole 1.x line is EOL, its
    // last tag 1.9.63 stopped in June 2026. 2.2.6 is the newest stable and is
    // taken over the slightly more matured 2.2.5 because it carries a security
    // fix — stored XSS in rich-text fields written through the API (#10425).
    // The default (non-`-no-nginx`) image runs nginx in front of the Node
    // process and still listens on 80, and the app still lives at
    // /app/nocobase with its storage dir under it, so no compose change beyond
    // the tag was required.
    compose: `name: nocobase
services:
  nocobase:
    image: nocobase/nocobase:2.2.6
    depends_on:
      - db
    environment:
      APP_KEY: \${APP_KEY}
      DB_DIALECT: postgres
      DB_HOST: "\${{stack.db.HOST}}"
      DB_PORT: "5432"
      DB_DATABASE: nocobase
      DB_USER: nocobase
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      TZ: UTC
    ports:
      - "80"
    volumes:
      - nocobase-storage:/app/nocobase/storage
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: nocobase
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: nocobase
    volumes:
      - nocobase-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nocobase"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  nocobase-storage:
  nocobase-db:
`,
  },
];
