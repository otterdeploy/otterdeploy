// Data & storage templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DATA_TEMPLATES: StackTemplate[] = [
  {
    id: "minio",
    name: "MinIO",
    description:
      "S3-compatible object storage. Exposes the S3 API on 9000 and the web console on 9001; buckets persist to a named volume.",
    category: "data",
    includes: ["minio"],
    requiredEnv: [
      {
        key: "MINIO_ROOT_USER",
        description: "Root access key (username) — at least 3 characters.",
      },
      {
        key: "MINIO_ROOT_PASSWORD",
        description: "Root secret key — at least 8 characters.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "MinIO",
    docsUrl: "https://min.io/docs/minio/container/index.html",
    compose: `name: minio
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    ports:
      - "9000"
      - "9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  minio-data:
`,
  },
  {
    id: "nocodb",
    name: "NocoDB",
    description:
      "Airtable-style smart spreadsheet over a real database. Runs the official image with a dedicated Postgres for its metadata and data.",
    category: "data",
    includes: ["nocodb", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the nocodb Postgres user.",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "NC_AUTH_JWT_SECRET",
        description: "Signing secret for NocoDB auth tokens.",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "NocoDB",
    docsUrl: "https://nocodb.com/docs/self-hosting",
    compose: `name: nocodb
services:
  nocodb:
    image: nocodb/nocodb:latest
    depends_on:
      - db
    environment:
      NC_DB: "pg://db:5432?u=nocodb&p=\${POSTGRES_PASSWORD}&d=nocodb"
      NC_AUTH_JWT_SECRET: \${NC_AUTH_JWT_SECRET}
    ports:
      - "8080"
    volumes:
      - nocodb-data:/usr/app/data
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: nocodb
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: nocodb
    volumes:
      - nocodb-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nocodb"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  nocodb-data:
  nocodb-db:
`,
  },
  {
    id: "rustfs",
    name: "RustFS",
    description:
      "High-performance, S3-compatible object storage written in Rust — a MinIO alternative. Serves the S3 API on 9000 with a web console on 9001; objects persist to a named volume.",
    category: "data",
    includes: ["rustfs"],
    requiredEnv: [
      {
        key: "RUSTFS_ACCESS_KEY",
        description: "Root access key (S3 access key ID).",
      },
      {
        key: "RUSTFS_SECRET_KEY",
        description: "Root secret key (S3 secret access key).",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "RustFS",
    docsUrl: "https://docs.rustfs.com/",
    compose: `name: rustfs
services:
  rustfs:
    image: rustfs/rustfs:latest
    environment:
      RUSTFS_ACCESS_KEY: \${RUSTFS_ACCESS_KEY}
      RUSTFS_SECRET_KEY: \${RUSTFS_SECRET_KEY}
      RUSTFS_VOLUMES: /data
      RUSTFS_ADDRESS: 0.0.0.0:9000
      RUSTFS_CONSOLE_ADDRESS: 0.0.0.0:9001
      RUSTFS_CONSOLE_ENABLE: "true"
    ports:
      - "9000"
      - "9001"
    volumes:
      - rustfs-data:/data
    restart: always
volumes:
  rustfs-data:
`,
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ",
    description:
      "Reliable message broker speaking AMQP (and more). Ships the management image so the web UI is available on 15672 alongside the AMQP port 5672; state persists to a named volume.",
    category: "data",
    includes: ["rabbitmq"],
    requiredEnv: [
      {
        key: "RABBITMQ_USER",
        description: "Default broker username.",
      },
      {
        key: "RABBITMQ_PASSWORD",
        description: "Password for the default broker user.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "RabbitMQ",
    docsUrl: "https://www.rabbitmq.com/docs/download",
    compose: `name: rabbitmq
services:
  rabbitmq:
    image: rabbitmq:3.13-management
    environment:
      RABBITMQ_DEFAULT_USER: \${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: \${RABBITMQ_PASSWORD}
    ports:
      - "5672"
      - "15672"
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5
    restart: always
volumes:
  rabbitmq-data:
`,
  },
  {
    id: "meilisearch",
    name: "Meilisearch",
    description:
      "Lightning-fast, typo-tolerant search engine with a simple REST API. A single service on port 7700; the index persists to a named volume.",
    category: "data",
    includes: ["meilisearch"],
    requiredEnv: [
      {
        key: "MEILI_MASTER_KEY",
        description: "Master key protecting the API — at least 16 bytes.",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "Meilisearch",
    docsUrl:
      "https://www.meilisearch.com/docs/learn/self_hosted/getting_started_with_self_hosted_meilisearch",
    compose: `name: meilisearch
services:
  meilisearch:
    image: getmeili/meilisearch:v1.49.0
    environment:
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
      MEILI_ENV: \${MEILI_ENV:-production}
    ports:
      - "7700"
    volumes:
      - meili-data:/meili_data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7700/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  meili-data:
`,
  },
];
