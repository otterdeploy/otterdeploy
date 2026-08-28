// Transactional email infrastructure: sending APIs you point at your own
// provider account. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const EMAIL_TEMPLATES: StackTemplate[] = [
  {
    id: "usesend",
    name: "useSend",
    descriptionKey: "templates.catalog.usesend.description",
    category: "devtools",
    includes: ["usesend", "postgres", "redis"],
    requiredEnv: [
      { key: "USESEND_URL", descriptionKey: "templates.catalog.usesend.env.USESEND_URL" },
      {
        key: "NEXTAUTH_SECRET",
        descriptionKey: "templates.catalog.usesend.env.NEXTAUTH_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.usesend.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "AWS_DEFAULT_REGION",
        descriptionKey: "templates.catalog.usesend.env.AWS_DEFAULT_REGION",
      },
      {
        key: "AWS_ACCESS_KEY_ID",
        descriptionKey: "templates.catalog.usesend.env.AWS_ACCESS_KEY_ID",
      },
      {
        key: "AWS_SECRET_ACCESS_KEY",
        descriptionKey: "templates.catalog.usesend.env.AWS_SECRET_ACCESS_KEY",
      },
      { key: "GITHUB_ID", descriptionKey: "templates.catalog.usesend.env.GITHUB_ID" },
      { key: "GITHUB_SECRET", descriptionKey: "templates.catalog.usesend.env.GITHUB_SECRET" },
    ],
    logoBrand: "useSend",
    docsUrl: "https://docs.usesend.com/get-started/self-hosting",
    compose: `name: usesend
services:
  usesend:
    image: usesend/usesend:latest
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: "postgresql://usesend:\${POSTGRES_PASSWORD}@\${{stack.postgres.HOST}}:5432/usesend"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
      NEXTAUTH_URL: \${USESEND_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      AWS_DEFAULT_REGION: \${AWS_DEFAULT_REGION}
      AWS_ACCESS_KEY_ID: \${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: \${AWS_SECRET_ACCESS_KEY}
      GITHUB_ID: \${GITHUB_ID}
      GITHUB_SECRET: \${GITHUB_SECRET}
      NEXT_PUBLIC_IS_CLOUD: "false"
    ports:
      - "3000"
    restart: always
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: usesend
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: usesend
    volumes:
      - usesend_db:/var/lib/postgresql/data
    restart: always
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--maxmemory-policy", "noeviction"]
    volumes:
      - usesend_redis:/data
    restart: always
volumes:
  usesend_db:
  usesend_redis:
`,
  },
];
