// CMS / publishing templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const CMS_TEMPLATES: StackTemplate[] = [
  {
    id: "ghost",
    name: "Ghost",
    descriptionKey: "templates.catalog.ghost.description",
    category: "cms",
    includes: ["ghost", "db"],
    requiredEnv: [
      {
        key: "GHOST_URL",
        descriptionKey: "templates.catalog.ghost.env.GHOST_URL",
      },
      {
        key: "MYSQL_PASSWORD",
        descriptionKey: "templates.catalog.ghost.env.MYSQL_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Ghost",
    docsUrl: "https://ghost.org/docs/install/docker/",
    compose: `name: ghost
services:
  ghost:
    image: ghost:6.62.0-alpine
    depends_on:
      - db
    environment:
      url: \${GHOST_URL}
      database__client: mysql
      database__connection__host: "\${{stack.db.HOST}}"
      database__connection__user: ghost
      database__connection__password: \${MYSQL_PASSWORD}
      database__connection__database: ghost
    ports:
      - "2368"
    volumes:
      - ghost-content:/var/lib/ghost/content
    restart: always
  db:
    image: mysql:8.4
    environment:
      MYSQL_USER: ghost
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
      MYSQL_DATABASE: ghost
      MYSQL_RANDOM_ROOT_PASSWORD: "1"
    volumes:
      - ghost-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  ghost-content:
  ghost-db:
`,
  },
  {
    id: "directus",
    name: "Directus",
    descriptionKey: "templates.catalog.directus.description",
    category: "cms",
    includes: ["directus", "db"],
    requiredEnv: [
      {
        key: "DIRECTUS_SECRET",
        descriptionKey: "templates.catalog.directus.env.DIRECTUS_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      { key: "ADMIN_EMAIL", descriptionKey: "templates.catalog.directus.env.ADMIN_EMAIL" },
      {
        key: "ADMIN_PASSWORD",
        descriptionKey: "templates.catalog.directus.env.ADMIN_PASSWORD",
        generateHint: "openssl rand -base64 18",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.directus.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Directus",
    docsUrl: "https://directus.io/docs/self-hosting/overview",
    compose: `name: directus
services:
  directus:
    image: directus/directus:12.3.1
    depends_on:
      - db
    environment:
      SECRET: \${DIRECTUS_SECRET}
      ADMIN_EMAIL: \${ADMIN_EMAIL}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      DB_CLIENT: pg
      DB_HOST: "\${{stack.db.HOST}}"
      DB_PORT: "5432"
      DB_DATABASE: directus
      DB_USER: directus
      DB_PASSWORD: \${POSTGRES_PASSWORD}
    ports:
      - "8055"
    volumes:
      - directus-uploads:/directus/uploads
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: directus
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: directus
    volumes:
      - directus-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U directus"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  directus-uploads:
  directus-db:
`,
  },
];
