// Data-layer templates: an instant API, a workflow engine, a message bus and a
// spreadsheet database. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const APPSTACK_TEMPLATES: StackTemplate[] = [
  {
    id: "hasura",
    name: "Hasura",
    descriptionKey: "templates.catalog.hasura.description",
    category: "data",
    includes: ["hasura", "db"],
    requiredEnv: [
      {
        key: "HASURA_ADMIN_SECRET",
        descriptionKey: "templates.catalog.hasura.env.HASURA_ADMIN_SECRET",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.hasura.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Hasura",
    docsUrl: "https://hasura.io/docs/2.0/getting-started/docker-simple/",
    compose: `name: hasura
services:
  hasura:
    image: hasura/graphql-engine:v2.50.1
    depends_on:
      - db
    environment:
      HASURA_GRAPHQL_DATABASE_URL: "postgres://hasura:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/hasura"
      HASURA_GRAPHQL_METADATA_DATABASE_URL: "postgres://hasura:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/hasura"
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
    descriptionKey: "templates.catalog.temporal.description",
    category: "automation",
    includes: ["temporal", "ui", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.temporal.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Temporal",
    docsUrl: "https://docs.temporal.io/self-hosted-guide/deployment",
    compose: `name: temporal
services:
  temporal:
    image: temporalio/auto-setup:1.29.7
    depends_on:
      - db
    environment:
      DB: postgres12
      DB_PORT: "5432"
      POSTGRES_SEEDS: "\${{stack.db.HOST}}"
      POSTGRES_USER: temporal
      POSTGRES_PWD: \${POSTGRES_PASSWORD}
    ports:
      - "7233"
    restart: always
  ui:
    image: temporalio/ui:2.53.3
    depends_on:
      - temporal
    environment:
      TEMPORAL_ADDRESS: "\${{stack.temporal.HOST}}:7233"
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
    descriptionKey: "templates.catalog.nats.description",
    category: "data",
    includes: ["nats"],
    requiredEnv: [],
    logoBrand: "NATS",
    docsUrl: "https://docs.nats.io/running-a-nats-service/nats_docker",
    compose: `name: nats
services:
  nats:
    image: nats:2.14-alpine
    command:
      - --jetstream
      - --store_dir=/data
      - --http_port=8222
    ports:
      # Monitoring HTTP FIRST: reconcile-map marks the first port primary, and
      # the primary is what the generated domain reverse-proxies to. 4222 is
      # the binary NATS protocol, which a browser cannot speak, so leading with
      # it makes Visit useless. Clients dial <service>:4222 explicitly over the
      # stack network and are unaffected by which port is primary.
      - "8222"
      - "4222"
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
    descriptionKey: "templates.catalog.baserow.description",
    category: "data",
    includes: ["baserow"],
    requiredEnv: [
      {
        key: "BASEROW_PUBLIC_URL",
        descriptionKey: "templates.catalog.baserow.env.BASEROW_PUBLIC_URL",
      },
      {
        key: "SECRET_KEY",
        descriptionKey: "templates.catalog.baserow.env.SECRET_KEY",
      },
    ],
    logoBrand: "Baserow",
    docsUrl: "https://baserow.io/docs/installation%2Finstall-with-docker",
    compose: `name: baserow
services:
  baserow:
    image: baserow/baserow:2.3.3
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
