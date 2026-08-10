// Data-layer templates: an instant API, a workflow engine, a message bus and a
// spreadsheet database. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const APPSTACK_TEMPLATES: StackTemplate[] = [
  {
    id: "hasura",
    name: "Hasura",
    description:
      "Instant GraphQL over Postgres. Introspects the schema and serves queries, mutations and subscriptions with row-level permissions, no resolvers to write.",
    category: "data",
    includes: ["hasura", "db"],
    requiredEnv: [
      {
        key: "HASURA_ADMIN_SECRET",
        description: "Admin secret for the console and unrestricted API access.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres that Hasura exposes.",
      },
    ],
    logoBrand: "Hasura",
    docsUrl: "https://hasura.io/docs/2.0/getting-started/docker-simple/",
    compose: `name: hasura
services:
  hasura:
    image: hasura/graphql-engine:v2.44.0
    depends_on:
      - db
    environment:
      HASURA_GRAPHQL_DATABASE_URL: "postgres://hasura:\${POSTGRES_PASSWORD}@db:5432/hasura"
      HASURA_GRAPHQL_METADATA_DATABASE_URL: "postgres://hasura:\${POSTGRES_PASSWORD}@db:5432/hasura"
      HASURA_GRAPHQL_ADMIN_SECRET: \${HASURA_ADMIN_SECRET}
      HASURA_GRAPHQL_ENABLE_CONSOLE: "true"
      HASURA_GRAPHQL_DEV_MODE: "false"
    ports:
      - "8080"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: hasura
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: hasura
    volumes:
      - hasura-db:/var/lib/postgresql/data
    restart: always
volumes:
  hasura-db:
`,
  },
  {
    id: "temporal",
    name: "Temporal",
    description:
      "Durable workflow engine. Long-running processes survive crashes, deploys and retries because state lives in the server, not your process. Ships with the web UI.",
    category: "automation",
    includes: ["temporal", "ui", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres holding workflow history.",
      },
    ],
    logoBrand: "Temporal",
    docsUrl: "https://docs.temporal.io/self-hosted-guide/setup",
    compose: `name: temporal
services:
  temporal:
    image: temporalio/auto-setup:1.28.1
    depends_on:
      - db
    environment:
      DB: postgres12
      DB_PORT: "5432"
      POSTGRES_SEEDS: db
      POSTGRES_USER: temporal
      POSTGRES_PWD: \${POSTGRES_PASSWORD}
    ports:
      - "7233"
    restart: always
  ui:
    image: temporalio/ui:2.53.0
    depends_on:
      - temporal
    environment:
      TEMPORAL_ADDRESS: "temporal:7233"
      TEMPORAL_CORS_ORIGINS: "http://localhost:3000"
    ports:
      - "8080"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: temporal
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: temporal
    volumes:
      - temporal-db:/var/lib/postgresql/data
    restart: always
volumes:
  temporal-db:
`,
  },
  {
    id: "nats",
    name: "NATS",
    description:
      "Messaging for services: pub/sub, request/reply and JetStream persistence in one small Go binary. A lighter answer than Kafka when you want a queue, not a log platform.",
    category: "data",
    includes: ["nats"],
    requiredEnv: [],
    logoBrand: "NATS",
    docsUrl: "https://docs.nats.io/running-a-nats-service/nats_docker",
    compose: `name: nats
services:
  nats:
    image: nats:2.11-alpine
    command:
      - --jetstream
      - --store_dir=/data
      - --http_port=8222
    ports:
      - "4222"
      - "8222"
    volumes:
      - nats-data:/data
    restart: always
volumes:
  nats-data:
`,
  },
  {
    id: "baserow",
    name: "Baserow",
    description:
      "Spreadsheet-shaped database with a REST API: an open-source Airtable. Single image bundling web, API and worker; data and uploads persist to one named volume.",
    category: "data",
    includes: ["baserow"],
    requiredEnv: [
      {
        key: "BASEROW_PUBLIC_URL",
        description: "Public base URL. The frontend calls the API at this address.",
      },
      {
        key: "SECRET_KEY",
        description: "Signs sessions and tokens.",
      },
    ],
    logoBrand: "Baserow",
    docsUrl: "https://baserow.io/docs/installation%2Finstall-with-docker",
    compose: `name: baserow
services:
  baserow:
    image: baserow/baserow:1.35.1
    environment:
      BASEROW_PUBLIC_URL: \${BASEROW_PUBLIC_URL}
      SECRET_KEY: \${SECRET_KEY}
    ports:
      - "80"
    volumes:
      - baserow-data:/baserow/data
    restart: always
volumes:
  baserow-data:
`,
  },
];
