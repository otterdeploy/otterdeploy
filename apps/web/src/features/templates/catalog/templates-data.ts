// Data & storage templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DATA_TEMPLATES: StackTemplate[] = [
  {
    id: "minio",
    name: "MinIO",
    descriptionKey: "templates.catalog.minio.description",
    category: "data",
    includes: ["minio"],
    requiredEnv: [
      {
        key: "MINIO_ROOT_USER",
        descriptionKey: "templates.catalog.minio.env.MINIO_ROOT_USER",
      },
      {
        key: "MINIO_ROOT_PASSWORD",
        descriptionKey: "templates.catalog.minio.env.MINIO_ROOT_PASSWORD",
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
      # Console FIRST: the primary port is what the generated domain routes to,
      # and a person clicking Visit wants the UI. Port 9000 is the S3 API, and a
      # browser GET on it correctly answers AccessDenied, which reads as a
      # broken deploy. SDKs reach the API with an explicit endpoint + creds and
      # do not depend on which port the platform made primary.
      - "9001"
      - "9000"
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
    descriptionKey: "templates.catalog.nocodb.description",
    category: "data",
    includes: ["nocodb", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.nocodb.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "NC_AUTH_JWT_SECRET",
        descriptionKey: "templates.catalog.nocodb.env.NC_AUTH_JWT_SECRET",
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
      NC_DB: "pg://\${{stack.db.HOST}}:5432?u=nocodb&p=\${POSTGRES_PASSWORD}&d=nocodb"
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
    descriptionKey: "templates.catalog.rustfs.description",
    category: "data",
    includes: ["rustfs"],
    requiredEnv: [
      {
        key: "RUSTFS_ACCESS_KEY",
        descriptionKey: "templates.catalog.rustfs.env.RUSTFS_ACCESS_KEY",
      },
      {
        key: "RUSTFS_SECRET_KEY",
        descriptionKey: "templates.catalog.rustfs.env.RUSTFS_SECRET_KEY",
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
      # Console FIRST: the primary port is what the generated domain routes to,
      # and a person clicking Visit wants the UI. Port 9000 is the S3 API, and a
      # browser GET on it correctly answers AccessDenied, which reads as a
      # broken deploy. SDKs reach the API with an explicit endpoint + creds and
      # do not depend on which port the platform made primary.
      - "9001"
      - "9000"
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
    descriptionKey: "templates.catalog.rabbitmq.description",
    category: "data",
    includes: ["rabbitmq"],
    requiredEnv: [
      {
        key: "RABBITMQ_USER",
        descriptionKey: "templates.catalog.rabbitmq.env.RABBITMQ_USER",
      },
      {
        key: "RABBITMQ_PASSWORD",
        descriptionKey: "templates.catalog.rabbitmq.env.RABBITMQ_PASSWORD",
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
    descriptionKey: "templates.catalog.meilisearch.description",
    category: "data",
    includes: ["meilisearch"],
    requiredEnv: [
      {
        key: "MEILI_MASTER_KEY",
        descriptionKey: "templates.catalog.meilisearch.env.MEILI_MASTER_KEY",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "Meilisearch",
    docsUrl:
      "https://www.meilisearch.com/docs/learn/self_hosted/getting_started_with_self_hosted_meilisearch",
    compose: `name: meilisearch
services:
  meilisearch:
    image: getmeili/meilisearch:v1.53.1
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
