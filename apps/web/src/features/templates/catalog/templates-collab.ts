// Collaborative documents: signing flows and local-first workspaces. Split
// out of templates-workspace.ts under the file cap; see ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const COLLAB_TEMPLATES: StackTemplate[] = [
  {
    id: "documenso",
    name: "Documenso",
    descriptionKey: "templates.catalog.documenso.description",
    category: "productivity",
    includes: ["documenso", "database"],
    requiredEnv: [
      { key: "DOCUMENSO_URL", descriptionKey: "templates.catalog.documenso.env.DOCUMENSO_URL" },
      {
        key: "NEXTAUTH_SECRET",
        descriptionKey: "templates.catalog.documenso.env.NEXTAUTH_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "NEXT_PRIVATE_ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.documenso.env.NEXT_PRIVATE_ENCRYPTION_KEY",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY",
        descriptionKey: "templates.catalog.documenso.env.NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.documenso.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      { key: "SMTP_HOST", descriptionKey: "templates.catalog.documenso.env.SMTP_HOST" },
      { key: "SMTP_USERNAME", descriptionKey: "templates.catalog.documenso.env.SMTP_USERNAME" },
      { key: "SMTP_PASSWORD", descriptionKey: "templates.catalog.documenso.env.SMTP_PASSWORD" },
      {
        key: "SMTP_FROM_ADDRESS",
        descriptionKey: "templates.catalog.documenso.env.SMTP_FROM_ADDRESS",
      },
    ],
    logoBrand: "Documenso",
    docsUrl: "https://docs.documenso.com/self-hosting/deployment/docker-compose",
    compose: `name: documenso
services:
  documenso:
    image: documenso/documenso:v2.17.0
    depends_on:
      - database
    environment:
      NEXT_PUBLIC_WEBAPP_URL: \${DOCUMENSO_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      NEXT_PRIVATE_ENCRYPTION_KEY: \${NEXT_PRIVATE_ENCRYPTION_KEY}
      NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY: \${NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY}
      NEXT_PRIVATE_DATABASE_URL: "postgresql://documenso:\${POSTGRES_PASSWORD}@\${{stack.database.HOST}}:5432/documenso"
      NEXT_PRIVATE_DIRECT_DATABASE_URL: "postgresql://documenso:\${POSTGRES_PASSWORD}@\${{stack.database.HOST}}:5432/documenso"
      NEXT_PUBLIC_UPLOAD_TRANSPORT: database
      NEXT_PRIVATE_SMTP_TRANSPORT: smtp-auth
      NEXT_PRIVATE_SMTP_HOST: \${SMTP_HOST}
      NEXT_PRIVATE_SMTP_PORT: "\${SMTP_PORT:-587}"
      NEXT_PRIVATE_SMTP_USERNAME: \${SMTP_USERNAME}
      NEXT_PRIVATE_SMTP_PASSWORD: \${SMTP_PASSWORD}
      NEXT_PRIVATE_SMTP_FROM_NAME: "\${SMTP_FROM_NAME:-Documenso}"
      NEXT_PRIVATE_SMTP_FROM_ADDRESS: \${SMTP_FROM_ADDRESS}
    ports:
      - "3000"
    restart: always
  database:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: documenso
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: documenso
    volumes:
      - documenso_db:/var/lib/postgresql/data
    restart: always
volumes:
  documenso_db:
`,
  },
  {
    id: "affine",
    name: "AFFiNE",
    descriptionKey: "templates.catalog.affine.description",
    category: "productivity",
    includes: ["affine", "affine_migration", "postgres", "redis"],
    requiredEnv: [
      { key: "AFFINE_URL", descriptionKey: "templates.catalog.affine.env.AFFINE_URL" },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.affine.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "AFFiNE",
    docsUrl: "https://docs.affine.pro/self-host-affine/get-started",
    compose: `name: affine
services:
  affine:
    image: ghcr.io/toeverything/affine:0.27.4
    depends_on:
      - affine_migration
      - postgres
      - redis
    environment:
      AFFINE_SERVER_EXTERNAL_URL: \${AFFINE_URL}
      REDIS_SERVER_HOST: \${{stack.redis.HOST}}
      DATABASE_URL: "postgresql://affine:\${POSTGRES_PASSWORD}@\${{stack.postgres.HOST}}:5432/affine"
    volumes:
      - affine_storage:/root/.affine/storage
      - affine_config:/root/.affine/config
    ports:
      - "3010"
    restart: unless-stopped
  affine_migration:
    image: ghcr.io/toeverything/affine:0.27.4
    command: ["sh", "-c", "node ./scripts/self-host-predeploy.js"]
    depends_on:
      - postgres
      - redis
    environment:
      REDIS_SERVER_HOST: \${{stack.redis.HOST}}
      DATABASE_URL: "postgresql://affine:\${POSTGRES_PASSWORD}@\${{stack.postgres.HOST}}:5432/affine"
    volumes:
      - affine_storage:/root/.affine/storage
      - affine_config:/root/.affine/config
    restart: "no"
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: affine
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: affine
      POSTGRES_INITDB_ARGS: "--data-checksums"
    volumes:
      - affine_db:/var/lib/postgresql/data
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    volumes:
      - affine_redis:/data
    restart: unless-stopped
volumes:
  affine_storage:
  affine_config:
  affine_db:
  affine_redis:
`,
  },
];
