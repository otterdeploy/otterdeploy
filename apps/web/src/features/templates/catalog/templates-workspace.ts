// Scheduling, tasks, and document tooling. Split out of
// templates-productivity.ts; see ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const WORKSPACE_TEMPLATES: StackTemplate[] = [
  {
    id: "cal-com",
    name: "Cal.com",
    descriptionKey: "templates.catalog.cal-com.description",
    category: "productivity",
    includes: ["calcom", "db"],
    requiredEnv: [
      { key: "CALCOM_URL", descriptionKey: "templates.catalog.cal-com.env.CALCOM_URL" },
      {
        key: "NEXTAUTH_SECRET",
        descriptionKey: "templates.catalog.cal-com.env.NEXTAUTH_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "CALENDSO_ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.cal-com.env.CALENDSO_ENCRYPTION_KEY",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.cal-com.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Cal.com",
    docsUrl: "https://cal.com/docs/introduction/quick-start/self-hosting/docker",
    compose: `name: cal-com
services:
  calcom:
    image: calcom/cal.com:v6.2.0
    depends_on:
      - db
    environment:
      NEXT_PUBLIC_WEBAPP_URL: \${CALCOM_URL}
      NEXTAUTH_URL: \${CALCOM_URL}
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      CALENDSO_ENCRYPTION_KEY: \${CALENDSO_ENCRYPTION_KEY}
      DATABASE_URL: "postgresql://calcom:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/calcom"
      DATABASE_DIRECT_URL: "postgresql://calcom:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/calcom"
      NEXT_PUBLIC_LICENSE_CONSENT: agree
    ports:
      - "3000"
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: calcom
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: calcom
    volumes:
      - calcom-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U calcom"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  calcom-db:
`,
  },
  {
    id: "vikunja",
    name: "Vikunja",
    descriptionKey: "templates.catalog.vikunja.description",
    category: "productivity",
    includes: ["vikunja", "db"],
    requiredEnv: [
      { key: "VIKUNJA_URL", descriptionKey: "templates.catalog.vikunja.env.VIKUNJA_URL" },
      {
        key: "VIKUNJA_JWT_SECRET",
        descriptionKey: "templates.catalog.vikunja.env.VIKUNJA_JWT_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.vikunja.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Vikunja",
    docsUrl: "https://vikunja.io/docs/full-docker-example/",
    compose: `name: vikunja
services:
  vikunja:
    image: vikunja/vikunja:0.24.6
    depends_on:
      - db
    environment:
      VIKUNJA_SERVICE_PUBLICURL: \${VIKUNJA_URL}
      VIKUNJA_SERVICE_JWTSECRET: \${VIKUNJA_JWT_SECRET}
      VIKUNJA_DATABASE_TYPE: postgres
      VIKUNJA_DATABASE_HOST: "\${{stack.db.HOST}}"
      VIKUNJA_DATABASE_DATABASE: vikunja
      VIKUNJA_DATABASE_USER: vikunja
      VIKUNJA_DATABASE_PASSWORD: \${POSTGRES_PASSWORD}
    ports:
      - "3456"
    volumes:
      - vikunja-files:/app/vikunja/files
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: vikunja
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: vikunja
    volumes:
      - vikunja-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vikunja"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  vikunja-files:
  vikunja-db:
`,
  },
  {
    id: "stirling-pdf",
    name: "Stirling PDF",
    descriptionKey: "templates.catalog.stirling-pdf.description",
    category: "productivity",
    includes: ["stirling-pdf"],
    requiredEnv: [],
    logoBrand: "Stirling PDF",
    docsUrl: "https://docs.stirlingpdf.com/Installation/Docker%20Install",
    compose: `name: stirling-pdf
services:
  stirling-pdf:
    image: ghcr.io/stirling-tools/stirling-pdf:latest
    environment:
      DISABLE_ADDITIONAL_FEATURES: "true"
      LANGS: en_GB
    ports:
      - "8080"
    volumes:
      - stirling-configs:/configs
      - stirling-custom-files:/customFiles
      - stirling-logs:/logs
    restart: always
volumes:
  stirling-configs:
  stirling-custom-files:
  stirling-logs:
`,
  },
];
