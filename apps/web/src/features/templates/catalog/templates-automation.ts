// Workflow engines, marketing automation, and home automation. See ./types.ts
// for the honesty contract.
import type { StackTemplate } from "./types";

export const AUTOMATION_TEMPLATES: StackTemplate[] = [
  {
    id: "home-assistant",
    name: "Home Assistant",
    descriptionKey: "templates.catalog.home-assistant.description",
    category: "automation",
    includes: ["homeassistant"],
    requiredEnv: [],
    logoBrand: "Home Assistant",
    docsUrl: "https://www.home-assistant.io/installation/linux#docker-compose",
    // Bridge networking, not host networking: this runs on a server, not on
    // the LAN the devices live on. Cloud and IP integrations work; the
    // broadcast-based auto-discovery ones (mDNS, SSDP) will not find anything
    // on their own, so add those devices by address, or point Home Assistant
    // at the catalog's Mosquitto stack and let the devices come to it.
    compose: `name: home-assistant
services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:2025.8
    environment:
      TZ: UTC
    ports:
      - "8123"
    volumes:
      - homeassistant-config:/config
    restart: always
volumes:
  homeassistant-config:
`,
  },
  {
    id: "windmill",
    name: "Windmill",
    descriptionKey: "templates.catalog.windmill.description",
    category: "automation",
    includes: ["server", "worker", "db"],
    requiredEnv: [
      {
        key: "WINDMILL_BASE_URL",
        descriptionKey: "templates.catalog.windmill.env.WINDMILL_BASE_URL",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.windmill.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Windmill",
    docsUrl: "https://www.windmill.dev/docs/advanced/self_host",
    // Same image on both services; MODE is what decides whether a container
    // serves the API or drains the job queue. Scale the worker to add capacity.
    compose: `name: windmill
services:
  server:
    image: ghcr.io/windmill-labs/windmill:main
    depends_on:
      - db
    environment:
      MODE: server
      BASE_URL: \${WINDMILL_BASE_URL}
      DATABASE_URL: "postgres://windmill:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/windmill?sslmode=disable"
      RUST_LOG: info
    ports:
      - "8000"
    volumes:
      - windmill-logs:/tmp/windmill/logs
    restart: always
  worker:
    image: ghcr.io/windmill-labs/windmill:main
    depends_on:
      - db
    environment:
      MODE: worker
      WORKER_GROUP: default
      DATABASE_URL: "postgres://windmill:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/windmill?sslmode=disable"
      RUST_LOG: info
    volumes:
      - windmill-cache:/tmp/windmill/cache
      - windmill-logs:/tmp/windmill/logs
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: windmill
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: windmill
    volumes:
      - windmill-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U windmill"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  windmill-cache:
  windmill-logs:
  windmill-db:
`,
  },
  {
    id: "kestra",
    name: "Kestra",
    descriptionKey: "templates.catalog.kestra.description",
    category: "automation",
    includes: ["kestra", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.kestra.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Kestra",
    docsUrl: "https://kestra.io/docs/installation/docker-compose",
    // Kestra takes its whole configuration as one YAML document in an env var
    // rather than a file, which is what lets this ship without a bind mount.
    compose: `name: kestra
services:
  kestra:
    image: kestra/kestra:v0.21.5
    depends_on:
      - db
    command: ["server", "standalone"]
    environment:
      KESTRA_CONFIGURATION: |
        datasources:
          postgres:
            url: jdbc:postgresql://\${{stack.db.HOST}}:5432/kestra
            driverClassName: org.postgresql.Driver
            username: kestra
            password: \${POSTGRES_PASSWORD}
        kestra:
          server:
            basic-auth:
              enabled: false
          repository:
            type: postgres
          storage:
            type: local
            local:
              base-path: "/app/storage"
          queue:
            type: postgres
          tasks:
            tmp-dir:
              path: /tmp/kestra-wd/tmp
    ports:
      - "8080"
    volumes:
      - kestra-storage:/app/storage
      - kestra-wd:/tmp/kestra-wd
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: kestra
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: kestra
    volumes:
      - kestra-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kestra"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  kestra-storage:
  kestra-wd:
  kestra-db:
`,
  },
  {
    id: "mautic",
    name: "Mautic",
    descriptionKey: "templates.catalog.mautic.description",
    category: "automation",
    includes: ["mautic", "db"],
    requiredEnv: [
      { key: "MAUTIC_URL", descriptionKey: "templates.catalog.mautic.env.MAUTIC_URL" },
      {
        key: "MYSQL_PASSWORD",
        descriptionKey: "templates.catalog.mautic.env.MYSQL_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Mautic",
    docsUrl: "https://github.com/mautic/docker-mautic",
    // `MAUTIC_RUN_CRON_JOBS` matters more than it looks: Mautic's segments,
    // campaigns and e-mail queue are all driven by cron, and with it off the
    // install comes up looking healthy and then never sends anything.
    compose: `name: mautic
services:
  mautic:
    image: mautic/mautic:6-apache
    depends_on:
      - db
    environment:
      MAUTIC_DB_HOST: "\${{stack.db.HOST}}"
      MAUTIC_DB_NAME: mautic
      MAUTIC_DB_USER: mautic
      MAUTIC_DB_PASSWORD: \${MYSQL_PASSWORD}
      MAUTIC_URL: \${MAUTIC_URL}
      MAUTIC_RUN_CRON_JOBS: "true"
      MAUTIC_TRUSTED_PROXIES: "0.0.0.0/0"
    ports:
      - "80"
    volumes:
      - mautic-config:/var/www/html/config
      - mautic-logs:/var/www/html/var/logs
      - mautic-media:/var/www/html/docroot/media
    restart: always
  db:
    image: mysql:8.4
    environment:
      MYSQL_DATABASE: mautic
      MYSQL_USER: mautic
      MYSQL_PASSWORD: \${MYSQL_PASSWORD}
      MYSQL_RANDOM_ROOT_PASSWORD: "1"
    volumes:
      - mautic-db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  mautic-config:
  mautic-logs:
  mautic-media:
  mautic-db:
`,
  },
];
