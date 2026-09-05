// Identity, secrets and knowledge-base templates. See ./types.ts for the
// honesty contract.
import type { StackTemplate } from "./types";

export const PLATFORM_ID_TEMPLATES: StackTemplate[] = [
  {
    id: "infisical",
    name: "Infisical",
    descriptionKey: "templates.catalog.infisical.description",
    category: "security",
    includes: ["infisical", "db", "redis"],
    requiredEnv: [
      {
        key: "SITE_URL",
        descriptionKey: "templates.catalog.infisical.env.SITE_URL",
      },
      {
        key: "ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.infisical.env.ENCRYPTION_KEY",
      },
      {
        key: "AUTH_SECRET",
        descriptionKey: "templates.catalog.infisical.env.AUTH_SECRET",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.infisical.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Infisical",
    docsUrl: "https://infisical.com/docs/self-hosting/deployment-options/docker-compose",
    compose: `name: infisical
services:
  infisical:
    image: infisical/infisical:v0.165.2
    depends_on:
      - db
      - redis
    environment:
      SITE_URL: \${SITE_URL}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      AUTH_SECRET: \${AUTH_SECRET}
      DB_CONNECTION_URI: "postgres://infisical:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/infisical"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
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
    descriptionKey: "templates.catalog.keycloak.description",
    category: "security",
    includes: ["keycloak", "db"],
    requiredEnv: [
      {
        key: "KEYCLOAK_HOSTNAME",
        descriptionKey: "templates.catalog.keycloak.env.KEYCLOAK_HOSTNAME",
      },
      {
        key: "KEYCLOAK_ADMIN_PASSWORD",
        descriptionKey: "templates.catalog.keycloak.env.KEYCLOAK_ADMIN_PASSWORD",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.keycloak.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Keycloak",
    docsUrl: "https://www.keycloak.org/getting-started/getting-started-docker",
    compose: `name: keycloak
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.7.3
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
      KC_DB_URL: "jdbc:postgresql://\${{stack.db.HOST}}:5432/keycloak"
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
    descriptionKey: "templates.catalog.docmost.description",
    category: "cms",
    includes: ["docmost", "db", "redis"],
    requiredEnv: [
      {
        key: "APP_URL",
        descriptionKey: "templates.catalog.docmost.env.APP_URL",
      },
      {
        key: "APP_SECRET",
        descriptionKey: "templates.catalog.docmost.env.APP_SECRET",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.docmost.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Docmost",
    docsUrl: "https://docmost.com/docs/installation",
    compose: `name: docmost
services:
  docmost:
    image: docmost/docmost:0.95.0
    depends_on:
      - db
      - redis
    environment:
      APP_URL: \${APP_URL}
      APP_SECRET: \${APP_SECRET}
      DATABASE_URL: "postgresql://docmost:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/docmost?schema=public"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
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
