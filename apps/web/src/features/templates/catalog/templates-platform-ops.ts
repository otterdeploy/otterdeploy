// Error tracking and notification templates: the ops half of the platform
// services. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const PLATFORM_OPS_TEMPLATES: StackTemplate[] = [
  {
    id: "glitchtip",
    name: "GlitchTip",
    descriptionKey: "templates.catalog.glitchtip.description",
    category: "observability",
    includes: ["glitchtip", "worker", "migrate", "db", "redis"],
    requiredEnv: [
      {
        key: "GLITCHTIP_DOMAIN",
        descriptionKey: "templates.catalog.glitchtip.env.GLITCHTIP_DOMAIN",
      },
      {
        key: "SECRET_KEY",
        descriptionKey: "templates.catalog.glitchtip.env.SECRET_KEY",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.glitchtip.env.POSTGRES_PASSWORD",
      },
      {
        key: "DEFAULT_FROM_EMAIL",
        descriptionKey: "templates.catalog.glitchtip.env.DEFAULT_FROM_EMAIL",
      },
    ],
    logoBrand: "GlitchTip",
    docsUrl: "https://glitchtip.com/documentation/install",
    compose: `name: glitchtip
services:
  glitchtip:
    image: glitchtip/glitchtip:6.2.6
    depends_on:
      - db
      - redis
    environment:
      DATABASE_URL: "postgres://glitchtip:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/glitchtip"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379/0"
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
    image: glitchtip/glitchtip:6.2.6
    command:
      - ./bin/run-worker.sh
    depends_on:
      - db
      - redis
    environment:
      DATABASE_URL: "postgres://glitchtip:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/glitchtip"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379/0"
      SECRET_KEY: \${SECRET_KEY}
      GLITCHTIP_DOMAIN: \${GLITCHTIP_DOMAIN}
      DEFAULT_FROM_EMAIL: \${DEFAULT_FROM_EMAIL}
      EMAIL_URL: "\${EMAIL_URL:-consolemail://}"
    volumes:
      - glitchtip-uploads:/code/uploads
    restart: always
  migrate:
    image: glitchtip/glitchtip:6.2.6
    command:
      - ./bin/run-migrate.sh
    depends_on:
      - db
    environment:
      DATABASE_URL: "postgres://glitchtip:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/glitchtip"
      REDIS_URL: "redis://\${{stack.redis.HOST}}:6379/0"
      SECRET_KEY: \${SECRET_KEY}
      GLITCHTIP_DOMAIN: \${GLITCHTIP_DOMAIN}
      DEFAULT_FROM_EMAIL: \${DEFAULT_FROM_EMAIL}
      EMAIL_URL: "\${EMAIL_URL:-consolemail://}"
    restart: "no"
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
    descriptionKey: "templates.catalog.ntfy.description",
    category: "automation",
    includes: ["ntfy"],
    requiredEnv: [
      {
        key: "NTFY_BASE_URL",
        descriptionKey: "templates.catalog.ntfy.env.NTFY_BASE_URL",
      },
    ],
    logoBrand: "ntfy",
    docsUrl: "https://docs.ntfy.sh/install/#docker",
    compose: `name: ntfy
services:
  ntfy:
    image: binwiederhier/ntfy:v2.28.0
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
    descriptionKey: "templates.catalog.listmonk.description",
    category: "automation",
    includes: ["listmonk", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.listmonk.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Listmonk",
    docsUrl: "https://listmonk.app/docs/installation/",
    compose: `name: listmonk
services:
  listmonk:
    image: listmonk/listmonk:v6.2.0
    command:
      - sh
      - -c
      - "./listmonk --install --idempotent --yes --config '' && ./listmonk --upgrade --yes --config '' && ./listmonk --config ''"
    depends_on:
      - db
    environment:
      LISTMONK_app__address: "0.0.0.0:9000"
      LISTMONK_db__host: "\${{stack.db.HOST}}"
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
