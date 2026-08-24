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
    // The community image is a full stack in one container (app, MongoDB,
    // Redis, nginx) under /appsmith-stacks, so the volume IS the install: lose
    // it and every app, datasource and credential goes with it.
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
    includes: ["tooljet", "db"],
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
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "ToolJet",
    docsUrl: "https://docs.tooljet.ai/docs/setup/docker",
    compose: `name: tooljet
services:
  tooljet:
    image: tooljet/tooljet:ee-lts-latest
    depends_on:
      - db
    environment:
      TOOLJET_HOST: \${TOOLJET_HOST}
      LOCKBOX_MASTER_KEY: \${LOCKBOX_MASTER_KEY}
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      PG_HOST: "\${{stack.db.HOST}}"
      PG_PORT: "5432"
      PG_DB: tooljet
      PG_USER: tooljet
      PG_PASS: \${POSTGRES_PASSWORD}
      DEPLOYMENT_PLATFORM: docker
    ports:
      - "80"
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
    // The all-in-one image bundles CouchDB, Redis and MinIO, so the secrets
    // below are what it uses to talk to its OWN internals: they are never
    // typed in anywhere, but changing one after first boot orphans the data
    // behind it.
    compose: `name: budibase
services:
  budibase:
    image: budibase/budibase:v3.43.0
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
    docsUrl: "https://docs.nocobase.com/handbook/deployment/docker-compose",
    compose: `name: nocobase
services:
  nocobase:
    image: nocobase/nocobase:1.6.15
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
