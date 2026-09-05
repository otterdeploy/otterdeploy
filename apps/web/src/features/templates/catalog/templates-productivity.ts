// Notes, docs, tasks, bookmarks, scheduling: the things a team reaches for
// daily. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const PRODUCTIVITY_TEMPLATES: StackTemplate[] = [
  {
    id: "outline",
    name: "Outline",
    descriptionKey: "templates.catalog.outline.description",
    category: "productivity",
    includes: ["outline", "db", "redis"],
    requiredEnv: [
      { key: "OUTLINE_URL", descriptionKey: "templates.catalog.outline.env.OUTLINE_URL" },
      {
        key: "SECRET_KEY",
        descriptionKey: "templates.catalog.outline.env.SECRET_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "UTILS_SECRET",
        descriptionKey: "templates.catalog.outline.env.UTILS_SECRET",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.outline.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
      { key: "OIDC_CLIENT_ID", descriptionKey: "templates.catalog.outline.env.OIDC_CLIENT_ID" },
      {
        key: "OIDC_CLIENT_SECRET",
        descriptionKey: "templates.catalog.outline.env.OIDC_CLIENT_SECRET",
      },
      { key: "OIDC_AUTH_URI", descriptionKey: "templates.catalog.outline.env.OIDC_AUTH_URI" },
      { key: "OIDC_TOKEN_URI", descriptionKey: "templates.catalog.outline.env.OIDC_TOKEN_URI" },
      {
        key: "OIDC_USERINFO_URI",
        descriptionKey: "templates.catalog.outline.env.OIDC_USERINFO_URI",
      },
    ],
    logoBrand: "Outline",
    docsUrl: "https://docs.getoutline.com/s/hosting/doc/docker-7pfeLP5a8t",
    // Outline has no local password login: it authenticates ONLY against an
    // identity provider, so the OIDC block is required rather than optional.
    // The catalog already ships three providers that satisfy it (Authentik,
    // Keycloak, Pocket ID).
    compose: `name: outline
services:
  outline:
    image: outlinewiki/outline:1.10.0
    depends_on:
      - db
      - redis
    environment:
      URL: \${OUTLINE_URL}
      PORT: "3000"
      SECRET_KEY: \${SECRET_KEY}
      UTILS_SECRET: \${UTILS_SECRET}
      DATABASE_URL: "postgres://outline:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/outline"
      PGSSLMODE: disable
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379"
      FILE_STORAGE: local
      FILE_STORAGE_LOCAL_ROOT_DIR: /var/lib/outline/data
      FILE_STORAGE_UPLOAD_MAX_SIZE: "26214400"
      OIDC_CLIENT_ID: \${OIDC_CLIENT_ID}
      OIDC_CLIENT_SECRET: \${OIDC_CLIENT_SECRET}
      OIDC_AUTH_URI: \${OIDC_AUTH_URI}
      OIDC_TOKEN_URI: \${OIDC_TOKEN_URI}
      OIDC_USERINFO_URI: \${OIDC_USERINFO_URI}
      OIDC_DISPLAY_NAME: SSO
      OIDC_USERNAME_CLAIM: preferred_username
      OIDC_SCOPES: "openid profile email"
    ports:
      - "3000"
    volumes:
      - outline-data:/var/lib/outline/data
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: outline
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: outline
    volumes:
      - outline-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U outline"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - outline-redis:/data
    restart: always
volumes:
  outline-data:
  outline-db:
  outline-redis:
`,
  },
  {
    id: "memos",
    name: "Memos",
    descriptionKey: "templates.catalog.memos.description",
    category: "productivity",
    includes: ["memos"],
    // Nothing to fill in: Memos stores everything in SQLite under its volume
    // and the first account to sign up becomes the ADMIN. Claim it immediately —
    // registration is open by default and reachable even in 0.30's private mode.
    // MEMOS_INSTANCE_URL is deliberately unset: since 0.30 an empty value keeps
    // the instance private (anonymous visitors get the sign-in page, no RSS).
    // Setting it to the public URL is what turns Explore/RSS/public memos on.
    requiredEnv: [],
    logoBrand: "Memos",
    docsUrl: "https://www.usememos.com/docs/deploy/docker",
    compose: `name: memos
services:
  memos:
    image: neosmemo/memos:0.30.0
    environment:
      MEMOS_PORT: "5230"
    ports:
      - "5230"
    volumes:
      - memos-data:/var/opt/memos
    restart: always
volumes:
  memos-data:
`,
  },
  {
    id: "karakeep",
    name: "Karakeep",
    descriptionKey: "templates.catalog.karakeep.description",
    category: "productivity",
    includes: ["web", "chrome", "meilisearch"],
    requiredEnv: [
      { key: "KARAKEEP_URL", descriptionKey: "templates.catalog.karakeep.env.KARAKEEP_URL" },
      {
        key: "NEXTAUTH_SECRET",
        descriptionKey: "templates.catalog.karakeep.env.NEXTAUTH_SECRET",
        generateHint: "openssl rand -base64 36",
      },
      {
        key: "MEILI_MASTER_KEY",
        descriptionKey: "templates.catalog.karakeep.env.MEILI_MASTER_KEY",
        generateHint: "openssl rand -base64 36",
      },
    ],
    logoBrand: "Karakeep",
    docsUrl: "https://docs.karakeep.app/Installation/docker",
    // The headless Chrome sidecar is what turns a saved link into a readable
    // archive and a screenshot; without it Karakeep still saves the URL but
    // every crawl fails.
    compose: `name: karakeep
services:
  web:
    image: ghcr.io/karakeep-app/karakeep:0.33.2
    depends_on:
      - chrome
      - meilisearch
    environment:
      NEXTAUTH_URL: \${KARAKEEP_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      DATA_DIR: /data
      MEILI_ADDR: "http://\${{stack.meilisearch.HOST}}:7700"
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
      BROWSER_WEB_URL: "http://\${{stack.chrome.HOST}}:9222"
    ports:
      - "3000"
    volumes:
      - karakeep-data:/data
    restart: always
  chrome:
    image: ghcr.io/karakeep-app/karakeep-chrome:151.0.7922.47-r1
    restart: always
  meilisearch:
    image: getmeili/meilisearch:v1.53.1
    environment:
      MEILI_NO_ANALYTICS: "true"
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
    volumes:
      - karakeep-search:/meili_data
    restart: always
volumes:
  karakeep-data:
  karakeep-search:
`,
  },
];
