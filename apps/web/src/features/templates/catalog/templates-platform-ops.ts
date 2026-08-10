// Error tracking and notification templates: the ops half of the platform
// services. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const PLATFORM_OPS_TEMPLATES: StackTemplate[] = [
  {
    id: "glitchtip",
    name: "GlitchTip",
    description:
      "Error tracking that speaks the Sentry protocol. Point any Sentry SDK at it by changing the DSN. Web and worker share a bundled Postgres and Redis; uploads persist to a volume.",
    category: "observability",
    includes: ["glitchtip", "worker", "db", "redis"],
    requiredEnv: [
      {
        key: "GLITCHTIP_DOMAIN",
        description: "Public base URL. Used in DSNs and links inside notification emails.",
      },
      {
        key: "SECRET_KEY",
        description: "Django secret. Signs sessions and tokens.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres.",
      },
      {
        key: "DEFAULT_FROM_EMAIL",
        description: "From-address on issue notification emails.",
      },
    ],
    logoBrand: "GlitchTip",
    docsUrl: "https://glitchtip.com/documentation/install",
    compose: `name: glitchtip
services:
  glitchtip:
    image: glitchtip/glitchtip:v5.0.5
    depends_on:
      - db
      - redis
    environment:
      DATABASE_URL: "postgres://glitchtip:\${POSTGRES_PASSWORD}@db:5432/glitchtip"
      REDIS_URL: "redis://redis:6379/0"
      SECRET_KEY: \${SECRET_KEY}
      GLITCHTIP_DOMAIN: \${GLITCHTIP_DOMAIN}
      DEFAULT_FROM_EMAIL: \${DEFAULT_FROM_EMAIL}
      EMAIL_URL: "\${EMAIL_URL:-consolemail://}"
    ports:
      - "8000"
    volumes:
      - glitchtip-uploads:/code/uploads
    restart: always
  worker:
    image: glitchtip/glitchtip:v5.0.5
    command:
      - ./bin/run-celery-with-beat.sh
    depends_on:
      - db
      - redis
    environment:
      DATABASE_URL: "postgres://glitchtip:\${POSTGRES_PASSWORD}@db:5432/glitchtip"
      REDIS_URL: "redis://redis:6379/0"
      SECRET_KEY: \${SECRET_KEY}
      GLITCHTIP_DOMAIN: \${GLITCHTIP_DOMAIN}
      DEFAULT_FROM_EMAIL: \${DEFAULT_FROM_EMAIL}
      EMAIL_URL: "\${EMAIL_URL:-consolemail://}"
    volumes:
      - glitchtip-uploads:/code/uploads
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: glitchtip
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: glitchtip
    volumes:
      - glitchtip-db:/var/lib/postgresql/data
    restart: always
  redis:
    image: redis:7-alpine
    restart: always
volumes:
  glitchtip-uploads:
  glitchtip-db:
`,
  },
  {
    id: "ntfy",
    name: "ntfy",
    description:
      "Pub-sub notifications over plain HTTP. Curl a topic and your phone buzzes. No account or SDK needed, which makes it the shortest path from a cron job or alert to a human.",
    category: "automation",
    includes: ["ntfy"],
    requiredEnv: [
      {
        key: "NTFY_BASE_URL",
        description: "Public base URL. Clients subscribe against it, and it appears in links.",
      },
    ],
    logoBrand: "ntfy",
    docsUrl: "https://docs.ntfy.sh/install/#docker",
    compose: `name: ntfy
services:
  ntfy:
    image: binwiederhier/ntfy:latest
    command:
      - serve
    environment:
      NTFY_BASE_URL: \${NTFY_BASE_URL}
      NTFY_BEHIND_PROXY: "true"
      NTFY_CACHE_FILE: /var/cache/ntfy/cache.db
      NTFY_AUTH_FILE: /var/lib/ntfy/auth.db
      NTFY_AUTH_DEFAULT_ACCESS: "\${NTFY_AUTH_DEFAULT_ACCESS:-deny-all}"
      NTFY_ATTACHMENT_CACHE_DIR: /var/cache/ntfy/attachments
      TZ: "\${TZ:-UTC}"
    ports:
      - "80"
    volumes:
      - ntfy-cache:/var/cache/ntfy
      - ntfy-data:/var/lib/ntfy
    restart: always
volumes:
  ntfy-cache:
  ntfy-data:
`,
  },
  {
    id: "listmonk",
    name: "Listmonk",
    description:
      "Newsletter and mailing-list manager: subscriber lists, segmentation, campaign templates and bounce handling, driven by your own SMTP. Single binary plus Postgres.",
    category: "automation",
    includes: ["listmonk", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres that stores subscribers and campaigns.",
      },
    ],
    logoBrand: "Listmonk",
    docsUrl: "https://listmonk.app/docs/installation/",
    compose: `name: listmonk
services:
  listmonk:
    image: listmonk/listmonk:latest
    command:
      - sh
      - -c
      - "./listmonk --install --idempotent --yes --config '' && ./listmonk --config ''"
    depends_on:
      - db
    environment:
      LISTMONK_app__address: "0.0.0.0:9000"
      LISTMONK_db__host: db
      LISTMONK_db__port: "5432"
      LISTMONK_db__user: listmonk
      LISTMONK_db__password: \${POSTGRES_PASSWORD}
      LISTMONK_db__database: listmonk
      LISTMONK_db__ssl_mode: disable
      TZ: "\${TZ:-UTC}"
    ports:
      - "9000"
    volumes:
      - listmonk-uploads:/listmonk/uploads
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: listmonk
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: listmonk
    volumes:
      - listmonk-db:/var/lib/postgresql/data
    restart: always
volumes:
  listmonk-uploads:
  listmonk-db:
`,
  },
];
