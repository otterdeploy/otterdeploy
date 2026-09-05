// Infrastructure the agent/AI stacks lean on: document conversion, workflow
// orchestration, and agent-shared workspaces. See ./types.ts for the honesty
// contract every entry here is held to.
import type { StackTemplate } from "./types";

export const AGENT_INFRA_TEMPLATES: StackTemplate[] = [
  {
    id: "docling",
    name: "Docling",
    descriptionKey: "templates.catalog.docling.description",
    category: "ai",
    includes: ["docling-serve"],
    requiredEnv: [
      {
        key: "DOCLING_API_KEY",
        descriptionKey: "templates.catalog.docling.env.DOCLING_API_KEY",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "Docling",
    docsUrl: "https://github.com/docling-project/docling-serve",
    compose: `name: docling
services:
  docling-serve:
    image: ghcr.io/docling-project/docling-serve-cpu:v1.32.0
    environment:
      DOCLING_SERVE_ENABLE_UI: "true"
      DOCLING_SERVE_API_KEY: \${DOCLING_API_KEY}
    ports:
      - "5001"
    restart: always
`,
  },
  {
    id: "inngest",
    name: "Inngest",
    descriptionKey: "templates.catalog.inngest.description",
    category: "automation",
    includes: ["inngest", "postgres", "redis"],
    requiredEnv: [
      {
        key: "INNGEST_EVENT_KEY",
        descriptionKey: "templates.catalog.inngest.env.INNGEST_EVENT_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "INNGEST_SIGNING_KEY",
        descriptionKey: "templates.catalog.inngest.env.INNGEST_SIGNING_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.inngest.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Inngest",
    docsUrl: "https://www.inngest.com/docs/self-hosting",
    compose: `name: inngest
services:
  inngest:
    image: inngest/inngest:v1.44.0
    command: ["inngest", "start"]
    depends_on:
      - postgres
      - redis
    environment:
      INNGEST_EVENT_KEY: \${INNGEST_EVENT_KEY}
      INNGEST_SIGNING_KEY: \${INNGEST_SIGNING_KEY}
      INNGEST_POSTGRES_URI: "postgres://inngest:\${POSTGRES_PASSWORD}@\${{stack.postgres.HOST}}:5432/inngest"
      INNGEST_REDIS_URI: "redis://\${{stack.redis.HOST}}:6379"
    ports:
      - "8288"
      - "8289"
    restart: always
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: inngest
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: inngest
    volumes:
      - inngest_db:/var/lib/postgresql/data
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - inngest_redis:/data
    restart: always
volumes:
  inngest_db:
  inngest_redis:
`,
  },
  {
    id: "buzz",
    name: "Buzz",
    descriptionKey: "templates.catalog.buzz.description",
    category: "communication",
    includes: ["relay", "postgres", "redis", "minio", "minio-init"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.buzz.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "REDIS_PASSWORD",
        descriptionKey: "templates.catalog.buzz.env.REDIS_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "BUZZ_S3_ACCESS_KEY",
        descriptionKey: "templates.catalog.buzz.env.BUZZ_S3_ACCESS_KEY",
      },
      {
        key: "BUZZ_S3_SECRET_KEY",
        descriptionKey: "templates.catalog.buzz.env.BUZZ_S3_SECRET_KEY",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "Buzz",
    docsUrl: "https://github.com/block/buzz/tree/main/deploy/compose",
    compose: `name: buzz
services:
  relay:
    image: ghcr.io/block/buzz:0.2.1
    depends_on:
      - postgres
      - redis
      - minio
      - minio-init
    environment:
      BUZZ_BIND_ADDR: 0.0.0.0:3000
      BUZZ_HEALTH_PORT: "8080"
      BUZZ_METRICS_PORT: "9102"
      DATABASE_URL: "postgres://buzz:\${POSTGRES_PASSWORD}@\${{stack.postgres.HOST}}:5432/buzz"
      REDIS_URL: "redis://:\${REDIS_PASSWORD}@\${{stack.redis.HOST}}:6379"
      BUZZ_S3_ENDPOINT: "http://\${{stack.minio.HOST}}:9000"
      BUZZ_S3_ADDRESSING_STYLE: path
      BUZZ_S3_ACCESS_KEY: \${BUZZ_S3_ACCESS_KEY}
      BUZZ_S3_SECRET_KEY: \${BUZZ_S3_SECRET_KEY}
      BUZZ_S3_BUCKET: buzz-media
      BUZZ_GIT_REPO_PATH: /data/git
      BUZZ_AUTO_MIGRATE: "true"
    ports:
      - "3000"
    volumes:
      - buzz_git:/data/git
    restart: unless-stopped
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: buzz
      POSTGRES_USER: buzz
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - buzz_db:/var/lib/postgresql/data
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "\${REDIS_PASSWORD}"]
    volumes:
      - buzz_redis:/data
    restart: unless-stopped
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: \${BUZZ_S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: \${BUZZ_S3_SECRET_KEY}
    volumes:
      - buzz_minio:/data
    restart: unless-stopped
  minio-init:
    image: minio/mc:RELEASE.2025-08-13T08-35-41Z
    depends_on:
      - minio
    environment:
      MC_HOST_local: "http://\${BUZZ_S3_ACCESS_KEY}:\${BUZZ_S3_SECRET_KEY}@\${{stack.minio.HOST}}:9000"
    command: ["mb", "--ignore-existing", "local/buzz-media"]
    restart: "no"
volumes:
  buzz_git:
  buzz_db:
  buzz_redis:
  buzz_minio:
`,
  },
];
