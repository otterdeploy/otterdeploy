// Documentation and knowledge bases. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const WIKI_TEMPLATES: StackTemplate[] = [
  {
    id: "bookstack",
    name: "BookStack",
    descriptionKey: "templates.catalog.bookstack.description",
    category: "cms",
    includes: ["bookstack", "db"],
    requiredEnv: [
      { key: "BOOKSTACK_URL", descriptionKey: "templates.catalog.bookstack.env.BOOKSTACK_URL" },
      {
        key: "APP_KEY",
        descriptionKey: "templates.catalog.bookstack.env.APP_KEY",
        generateHint: 'echo "base64:$(openssl rand -base64 32)"',
      },
      {
        key: "MYSQL_PASSWORD",
        descriptionKey: "templates.catalog.bookstack.env.MYSQL_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "BookStack",
    docsUrl: "https://www.bookstackapp.com/docs/admin/installation/#docker",
    // APP_KEY is Laravel's encryption key and must carry the `base64:` prefix.
    // BookStack encrypts stored third-party credentials with it, so replacing
    // it after first boot leaves those unreadable.
    compose: `name: bookstack
services:
  bookstack:
    image: lscr.io/linuxserver/bookstack:26.05.3
    depends_on:
      - db
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: UTC
      APP_URL: \${BOOKSTACK_URL}
      APP_KEY: \${APP_KEY}
      DB_HOST: "\${{stack.db.HOST}}"
      DB_PORT: "3306"
      DB_DATABASE: bookstack
      DB_USERNAME: bookstack
      DB_PASSWORD: \${MYSQL_PASSWORD}
    ports:
      - "80"
    volumes:
      - bookstack-config:/config
    restart: always
  db:
    image: mariadb:11.4
    environment:
      MARIADB_DATABASE: bookstack
      MARIADB_USER: bookstack
      MARIADB_PASSWORD: \${MYSQL_PASSWORD}
      MARIADB_RANDOM_ROOT_PASSWORD: "1"
    volumes:
      - bookstack-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  bookstack-config:
  bookstack-db:
`,
  },
  {
    id: "wikijs",
    name: "Wiki.js",
    descriptionKey: "templates.catalog.wikijs.description",
    category: "cms",
    includes: ["wiki", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.wikijs.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Wiki.js",
    docsUrl: "https://docs.requarks.io/install/docker",
    // Everything else is configured through the setup wizard on first visit,
    // which is why the database password is the only prompt here.
    compose: `name: wikijs
services:
  wiki:
    image: ghcr.io/requarks/wiki:2.5
    depends_on:
      - db
    environment:
      DB_TYPE: postgres
      DB_HOST: "\${{stack.db.HOST}}"
      DB_PORT: "5432"
      DB_USER: wikijs
      DB_PASS: \${POSTGRES_PASSWORD}
      DB_NAME: wiki
    ports:
      - "3000"
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: wikijs
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: wiki
    volumes:
      - wikijs-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wikijs"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  wikijs-db:
`,
  },
];
