// Identity, secrets and knowledge-base templates. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const PLATFORM_ID_TEMPLATES: StackTemplate[] = [
  {
    id: "infisical",
    name: "Infisical",
    description:
      "Secrets manager with per-environment values, versioning and audit logs, plus CLI and SDK access. Bundled Postgres for secrets and Redis for sessions and queues.",
    category: "security",
    includes: ["infisical", "db", "redis"],
    requiredEnv: [
      {
        key: "SITE_URL",
        description: "Public base URL. Used for invite links and OAuth callbacks.",
      },
      {
        key: "ENCRYPTION_KEY",
        description: "Encrypts every stored secret at rest. Losing it makes them unrecoverable.",
      },
      {
        key: "AUTH_SECRET",
        description: "Signs auth tokens.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres.",
      },
    ],
    logoBrand: "Infisical",
    docsUrl: "https://infisical.com/docs/self-hosting/deployment-options/docker-compose",
    compose: `name: infisical
services:
  infisical:
    image: infisical/infisical:v0.162.16
    depends_on:
      - db
      - redis
    environment:
      SITE_URL: \${SITE_URL}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      AUTH_SECRET: \${AUTH_SECRET}
      DB_CONNECTION_URI: "postgres://infisical:\${POSTGRES_PASSWORD}@db:5432/infisical"
      REDIS_URL: "redis://redis:6379"
      NODE_ENV: production
    ports:
      - "8080"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: infisical
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: infisical
    volumes:
      - infisical-db:/var/lib/postgresql/data
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - infisical-redis:/data
    restart: always
volumes:
  infisical-db:
  infisical-redis:
`,
  },
  {
    id: "keycloak",
    name: "Keycloak",
    description:
      "Identity provider with OIDC and SAML, user federation, social login and fine-grained authorization. The standard choice when something downstream expects real SSO.",
    category: "security",
    includes: ["keycloak", "db"],
    requiredEnv: [
      {
        key: "KEYCLOAK_HOSTNAME",
        description:
          "Public hostname Keycloak issues tokens for. It must match how users reach it.",
      },
      {
        key: "KEYCLOAK_ADMIN_PASSWORD",
        description: "Password for the bootstrap `admin` account.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres that stores realms and users.",
      },
    ],
    logoBrand: "Keycloak",
    docsUrl: "https://www.keycloak.org/getting-started/getting-started-docker",
    compose: `name: keycloak
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.4
    command:
      - start
      - --proxy-headers=xforwarded
      - --hostname-strict=false
    depends_on:
      - db
    environment:
      KC_HOSTNAME: \${KEYCLOAK_HOSTNAME}
      KC_HTTP_ENABLED: "true"
      KC_DB: postgres
      KC_DB_URL: "jdbc:postgresql://db:5432/keycloak"
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: \${POSTGRES_PASSWORD}
      KC_BOOTSTRAP_ADMIN_USERNAME: "\${KEYCLOAK_ADMIN:-admin}"
      KC_BOOTSTRAP_ADMIN_PASSWORD: \${KEYCLOAK_ADMIN_PASSWORD}
    ports:
      - "8080"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: keycloak
    volumes:
      - keycloak-db:/var/lib/postgresql/data
    restart: always
volumes:
  keycloak-db:
`,
  },
  {
    id: "docmost",
    name: "Docmost",
    description:
      "Collaborative wiki and documentation with real-time editing, spaces and permissions: a self-hosted alternative to Confluence or Notion. Postgres for content, Redis for presence.",
    category: "cms",
    includes: ["docmost", "db", "redis"],
    requiredEnv: [
      {
        key: "APP_URL",
        description: "Public base URL. Used for share links and invite emails.",
      },
      {
        key: "APP_SECRET",
        description: "Signs sessions and tokens.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres.",
      },
    ],
    logoBrand: "Docmost",
    docsUrl: "https://docmost.com/docs/self-hosting/installation",
    compose: `name: docmost
services:
  docmost:
    image: docmost/docmost:latest
    depends_on:
      - db
      - redis
    environment:
      APP_URL: \${APP_URL}
      APP_SECRET: \${APP_SECRET}
      DATABASE_URL: "postgresql://docmost:\${POSTGRES_PASSWORD}@db:5432/docmost?schema=public"
      REDIS_URL: "redis://redis:6379"
    ports:
      - "3000"
    volumes:
      - docmost-data:/app/data/storage
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: docmost
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: docmost
    volumes:
      - docmost-db:/var/lib/postgresql/data
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - docmost-redis:/data
    restart: always
volumes:
  docmost-data:
  docmost-db:
  docmost-redis:
`,
  },
];
