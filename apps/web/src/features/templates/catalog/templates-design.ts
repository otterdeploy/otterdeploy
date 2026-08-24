// Design and diagramming surfaces. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DESIGN_TEMPLATES: StackTemplate[] = [
  {
    id: "penpot",
    name: "Penpot",
    descriptionKey: "templates.catalog.penpot.description",
    category: "design",
    includes: ["frontend", "backend", "exporter", "db", "valkey"],
    requiredEnv: [
      {
        key: "PENPOT_PUBLIC_URI",
        descriptionKey: "templates.catalog.penpot.env.PENPOT_PUBLIC_URI",
      },
      {
        key: "PENPOT_SECRET_KEY",
        descriptionKey: "templates.catalog.penpot.env.PENPOT_SECRET_KEY",
        generateHint: "openssl rand -base64 48",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.penpot.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Penpot",
    docsUrl: "https://help.penpot.app/technical-guide/getting-started/",
    // `disable-email-verification` is deliberate: this stack ships no SMTP
    // server, and with verification on nobody can complete a sign-up. Add an
    // SMTP host and drop the flag before opening it to a wider team.
    compose: `name: penpot
services:
  frontend:
    image: penpotapp/frontend:2.9.0
    depends_on:
      - backend
      - exporter
    environment:
      PENPOT_FLAGS: "disable-email-verification disable-secure-session-cookies"
      PENPOT_PUBLIC_URI: \${PENPOT_PUBLIC_URI}
      PENPOT_BACKEND_URI: "http://\${{stack.backend.HOST}}:6060"
      PENPOT_EXPORTER_URI: "http://\${{stack.exporter.HOST}}:6061"
    ports:
      - "8080"
    volumes:
      - penpot-assets:/opt/data/assets
    restart: always
  backend:
    image: penpotapp/backend:2.9.0
    depends_on:
      - db
      - valkey
    environment:
      PENPOT_FLAGS: "disable-email-verification disable-secure-session-cookies"
      PENPOT_PUBLIC_URI: \${PENPOT_PUBLIC_URI}
      PENPOT_SECRET_KEY: \${PENPOT_SECRET_KEY}
      PENPOT_DATABASE_URI: "postgresql://\${{stack.db.HOST}}/penpot"
      PENPOT_DATABASE_USERNAME: penpot
      PENPOT_DATABASE_PASSWORD: \${POSTGRES_PASSWORD}
      PENPOT_REDIS_URI: "redis://\${{stack.valkey.HOST}}/0"
      PENPOT_OBJECTS_STORAGE_BACKEND: fs
      PENPOT_OBJECTS_STORAGE_FS_DIRECTORY: /opt/data/assets
      PENPOT_TELEMETRY_ENABLED: "false"
    volumes:
      - penpot-assets:/opt/data/assets
    restart: always
  exporter:
    image: penpotapp/exporter:2.9.0
    depends_on:
      - valkey
    environment:
      PENPOT_PUBLIC_URI: \${PENPOT_PUBLIC_URI}
      PENPOT_SECRET_KEY: \${PENPOT_SECRET_KEY}
      PENPOT_INTERNAL_URI: "http://\${{stack.frontend.HOST}}:8080"
      PENPOT_REDIS_URI: "redis://\${{stack.valkey.HOST}}/0"
    restart: always
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: penpot
      POSTGRES_USER: penpot
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_INITDB_ARGS: "--data-checksums"
    volumes:
      - penpot-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U penpot"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  valkey:
    image: valkey/valkey:8-alpine
    restart: always
volumes:
  penpot-assets:
  penpot-db:
`,
  },
];
