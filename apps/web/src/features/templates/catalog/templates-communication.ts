// Team chat, customer conversations, and calls. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const COMMUNICATION_TEMPLATES: StackTemplate[] = [
  {
    id: "mattermost",
    name: "Mattermost",
    descriptionKey: "templates.catalog.mattermost.description",
    category: "communication",
    includes: ["mattermost", "db"],
    requiredEnv: [
      {
        key: "MATTERMOST_URL",
        descriptionKey: "templates.catalog.mattermost.env.MATTERMOST_URL",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.mattermost.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Mattermost",
    docsUrl: "https://docs.mattermost.com/install/install-docker.html",
    compose: `name: mattermost
services:
  mattermost:
    image: mattermost/mattermost-team-edition:10.5
    depends_on:
      - db
    environment:
      MM_SERVICESETTINGS_SITEURL: \${MATTERMOST_URL}
      MM_SQLSETTINGS_DRIVERNAME: postgres
      MM_SQLSETTINGS_DATASOURCE: "postgres://mattermost:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/mattermost?sslmode=disable&connect_timeout=10"
      MM_BLEVESETTINGS_INDEXDIR: /mattermost/bleve-indexes
    ports:
      - "8065"
    volumes:
      - mattermost-config:/mattermost/config
      - mattermost-data:/mattermost/data
      - mattermost-logs:/mattermost/logs
      - mattermost-plugins:/mattermost/plugins
      - mattermost-client-plugins:/mattermost/client/plugins
      - mattermost-bleve:/mattermost/bleve-indexes
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mattermost
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: mattermost
    volumes:
      - mattermost-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mattermost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  mattermost-config:
  mattermost-data:
  mattermost-logs:
  mattermost-plugins:
  mattermost-client-plugins:
  mattermost-bleve:
  mattermost-db:
`,
  },
  {
    id: "chatwoot",
    name: "Chatwoot",
    descriptionKey: "templates.catalog.chatwoot.description",
    category: "communication",
    includes: ["rails", "sidekiq", "db", "redis"],
    requiredEnv: [
      { key: "FRONTEND_URL", descriptionKey: "templates.catalog.chatwoot.env.FRONTEND_URL" },
      {
        key: "SECRET_KEY_BASE",
        descriptionKey: "templates.catalog.chatwoot.env.SECRET_KEY_BASE",
        generateHint: "openssl rand -hex 64",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.chatwoot.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      {
        key: "REDIS_PASSWORD",
        descriptionKey: "templates.catalog.chatwoot.env.REDIS_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Chatwoot",
    docsUrl: "https://www.chatwoot.com/docs/self-hosted/deployment/docker",
    // `rails` and `sidekiq` are the same image with different commands, and the
    // web process ALSO runs the migrations on boot (docker/entrypoints/rails.sh).
    // That is why the worker can start alongside it rather than needing a
    // one-shot migration service, which this platform has nowhere to put.
    compose: `name: chatwoot
services:
  rails:
    image: chatwoot/chatwoot:v4.1.0
    depends_on:
      - db
      - redis
    entrypoint: docker/entrypoints/rails.sh
    command: ["bundle", "exec", "rails", "s", "-p", "3000", "-b", "0.0.0.0"]
    environment:
      NODE_ENV: production
      RAILS_ENV: production
      INSTALLATION_ENV: docker
      RAILS_LOG_TO_STDOUT: "true"
      FRONTEND_URL: \${FRONTEND_URL}
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      POSTGRES_HOST: "\${{stack.db.HOST}}"
      POSTGRES_USERNAME: chatwoot
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DATABASE: chatwoot
      REDIS_URL: "redis://:\${REDIS_PASSWORD}@\${{stack.redis.HOST}}:6379"
      REDIS_PASSWORD: \${REDIS_PASSWORD}
    ports:
      - "3000"
    volumes:
      - chatwoot-storage:/app/storage
    restart: always
  sidekiq:
    image: chatwoot/chatwoot:v4.1.0
    depends_on:
      - db
      - redis
    command: ["bundle", "exec", "sidekiq", "-C", "config/sidekiq.yml"]
    environment:
      NODE_ENV: production
      RAILS_ENV: production
      INSTALLATION_ENV: docker
      RAILS_LOG_TO_STDOUT: "true"
      FRONTEND_URL: \${FRONTEND_URL}
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      POSTGRES_HOST: "\${{stack.db.HOST}}"
      POSTGRES_USERNAME: chatwoot
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DATABASE: chatwoot
      REDIS_URL: "redis://:\${REDIS_PASSWORD}@\${{stack.redis.HOST}}:6379"
      REDIS_PASSWORD: \${REDIS_PASSWORD}
    volumes:
      - chatwoot-storage:/app/storage
    restart: always
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: chatwoot
      POSTGRES_USER: chatwoot
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - chatwoot-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chatwoot"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "\${REDIS_PASSWORD}"]
    volumes:
      - chatwoot-redis:/data
    restart: always
volumes:
  chatwoot-storage:
  chatwoot-db:
  chatwoot-redis:
`,
  },
];
