// Analytics / BI templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const ANALYTICS_TEMPLATES: StackTemplate[] = [
  {
    id: "plausible",
    name: "Plausible CE",
    description:
      "Privacy-friendly web analytics (Community Edition). Postgres holds app state, ClickHouse stores the event stream; migrations run automatically on boot.",
    category: "analytics",
    includes: ["plausible", "db", "events-db"],
    requiredEnv: [
      {
        key: "BASE_URL",
        description: "Public URL the dashboard is served from.",
      },
      {
        key: "SECRET_KEY_BASE",
        description: "Phoenix secret key base — must be at least 64 bytes.",
        generateHint: "openssl rand -base64 48",
      },
      {
        key: "TOTP_VAULT_KEY",
        description: "Key that encrypts 2FA/TOTP secrets at rest (required since v3) — a 32-byte key.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the postgres superuser.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Plausible",
    docsUrl: "https://github.com/plausible/community-edition",
    compose: `name: plausible
services:
  plausible:
    image: ghcr.io/plausible/community-edition:v3.2.1
    command: sh -c "/entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run"
    depends_on:
      - db
      - events-db
    environment:
      BASE_URL: \${BASE_URL}
      SECRET_KEY_BASE: \${SECRET_KEY_BASE}
      TOTP_VAULT_KEY: \${TOTP_VAULT_KEY}
      DATABASE_URL: postgres://postgres:\${POSTGRES_PASSWORD}@db:5432/plausible_db
      CLICKHOUSE_DATABASE_URL: http://events-db:8123/plausible_events_db
    ports:
      - "8000"
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: plausible_db
    volumes:
      - plausible-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  events-db:
    image: clickhouse/clickhouse-server:24.12-alpine
    environment:
      CLICKHOUSE_SKIP_USER_SETUP: "1"
    volumes:
      - plausible-events-db:/var/lib/clickhouse
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 -O - http://127.0.0.1:8123/ping || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  plausible-db:
  plausible-events-db:
`,
  },
  {
    id: "umami",
    name: "Umami",
    description:
      "Simple, fast, privacy-focused website analytics. One Node service over Postgres; the tracking script is served from the app itself.",
    category: "analytics",
    includes: ["umami", "db"],
    requiredEnv: [
      {
        key: "APP_SECRET",
        description: "Secret used to hash session tokens.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the umami Postgres user.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Umami",
    docsUrl: "https://umami.is/docs/install",
    compose: `name: umami
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    depends_on:
      - db
    environment:
      DATABASE_URL: postgresql://umami:\${POSTGRES_PASSWORD}@db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: \${APP_SECRET}
    ports:
      - "3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/heartbeat || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: umami
    volumes:
      - umami-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  umami-db:
`,
  },
  {
    id: "metabase",
    name: "Metabase",
    description:
      "Open-source BI — dashboards, questions, and SQL over your existing databases. Application state lives in a dedicated Postgres.",
    category: "analytics",
    includes: ["metabase", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the metabase Postgres user.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Metabase",
    docsUrl:
      "https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker",
    compose: `name: metabase
services:
  metabase:
    image: metabase/metabase:latest
    depends_on:
      - db
    environment:
      MB_DB_TYPE: postgres
      MB_DB_HOST: db
      MB_DB_PORT: "5432"
      MB_DB_DBNAME: metabase
      MB_DB_USER: metabase
      MB_DB_PASS: \${POSTGRES_PASSWORD}
    ports:
      - "3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: metabase
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: metabase
    volumes:
      - metabase-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U metabase"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  metabase-db:
`,
  },
];
