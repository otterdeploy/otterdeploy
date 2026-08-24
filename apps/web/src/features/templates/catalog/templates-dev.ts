// Security + dev-tool templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DEV_TEMPLATES: StackTemplate[] = [
  {
    id: "authentik",
    name: "Authentik",
    descriptionKey: "templates.catalog.authentik.description",
    category: "security",
    includes: ["server", "worker", "db", "redis"],
    requiredEnv: [
      {
        key: "SECRET_KEY",
        descriptionKey: "templates.catalog.authentik.env.SECRET_KEY",
        generateHint: "openssl rand -base64 60",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.authentik.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Authentik",
    docsUrl: "https://docs.goauthentik.io/docs/install-config/install/docker-compose",
    compose: `name: authentik
services:
  server:
    image: ghcr.io/goauthentik/server:2026.5.4
    command: server
    depends_on:
      - db
      - redis
    environment:
      AUTHENTIK_SECRET_KEY: \${SECRET_KEY}
      AUTHENTIK_POSTGRESQL__HOST: "\${{stack.db.HOST}}"
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: \${POSTGRES_PASSWORD}
      AUTHENTIK_REDIS__HOST: "\${{stack.redis.HOST}}"
    ports:
      - "9000"
    restart: always
  worker:
    image: ghcr.io/goauthentik/server:2026.5.4
    command: worker
    depends_on:
      - db
      - redis
    environment:
      AUTHENTIK_SECRET_KEY: \${SECRET_KEY}
      AUTHENTIK_POSTGRESQL__HOST: "\${{stack.db.HOST}}"
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: \${POSTGRES_PASSWORD}
      AUTHENTIK_REDIS__HOST: "\${{stack.redis.HOST}}"
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: authentik
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: authentik
    volumes:
      - authentik-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U authentik"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - authentik-redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  authentik-db:
  authentik-redis:
`,
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    descriptionKey: "templates.catalog.vaultwarden.description",
    category: "security",
    includes: ["vaultwarden"],
    requiredEnv: [
      {
        key: "DOMAIN",
        descriptionKey: "templates.catalog.vaultwarden.env.DOMAIN",
      },
      {
        key: "ADMIN_TOKEN",
        descriptionKey: "templates.catalog.vaultwarden.env.ADMIN_TOKEN",
        generateHint: "openssl rand -base64 48",
      },
    ],
    logoBrand: "Vaultwarden",
    docsUrl: "https://github.com/dani-garcia/vaultwarden/wiki",
    compose: `name: vaultwarden
services:
  vaultwarden:
    image: vaultwarden/server:latest
    environment:
      DOMAIN: \${DOMAIN}
      ADMIN_TOKEN: \${ADMIN_TOKEN}
      SIGNUPS_ALLOWED: \${SIGNUPS_ALLOWED:-false}
    ports:
      - "80"
    volumes:
      - vaultwarden-data:/data
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 30s
      retries: 3
    restart: always
volumes:
  vaultwarden-data:
`,
  },
  {
    id: "gitea",
    name: "Gitea",
    descriptionKey: "templates.catalog.gitea.description",
    category: "devtools",
    includes: ["gitea", "db"],
    requiredEnv: [
      {
        key: "ROOT_URL",
        descriptionKey: "templates.catalog.gitea.env.ROOT_URL",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.gitea.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Gitea",
    docsUrl: "https://docs.gitea.com/installation/install-with-docker",
    compose: `name: gitea
services:
  gitea:
    image: gitea/gitea:1.27
    depends_on:
      - db
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: "\${{stack.db.HOST}}:5432"
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: \${POSTGRES_PASSWORD}
      GITEA__server__ROOT_URL: \${ROOT_URL}
    ports:
      - "3000"
    volumes:
      - gitea-data:/data
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: gitea
    volumes:
      - gitea-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitea"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  gitea-data:
  gitea-db:
`,
  },
  {
    id: "excalidraw",
    name: "Excalidraw",
    descriptionKey: "templates.catalog.excalidraw.description",
    category: "devtools",
    includes: ["excalidraw"],
    requiredEnv: [],
    logoBrand: "Excalidraw",
    docsUrl: "https://github.com/excalidraw/excalidraw/tree/master/docker",
    compose: `name: excalidraw
services:
  excalidraw:
    image: excalidraw/excalidraw:latest
    ports:
      - "80"
    restart: always
`,
  },
];
