// Files and documents. Split out of templates-media.ts; see ./types.ts for
// the honesty contract.
import type { StackTemplate } from "./types";

export const FILES_TEMPLATES: StackTemplate[] = [
  {
    id: "nextcloud",
    name: "Nextcloud",
    descriptionKey: "templates.catalog.nextcloud.description",
    category: "media",
    includes: ["nextcloud", "db", "redis"],
    requiredEnv: [
      {
        key: "NEXTCLOUD_TRUSTED_DOMAIN",
        descriptionKey: "templates.catalog.nextcloud.env.NEXTCLOUD_TRUSTED_DOMAIN",
      },
      {
        key: "NEXTCLOUD_ADMIN_USER",
        descriptionKey: "templates.catalog.nextcloud.env.NEXTCLOUD_ADMIN_USER",
      },
      {
        key: "NEXTCLOUD_ADMIN_PASSWORD",
        descriptionKey: "templates.catalog.nextcloud.env.NEXTCLOUD_ADMIN_PASSWORD",
        generateHint: "openssl rand -base64 18",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.nextcloud.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Nextcloud",
    docsUrl: "https://github.com/nextcloud/docker#running-this-image-with-docker-compose",
    // Nextcloud keeps three majors maintained at once — 32, 33 and 34 all got
    // point releases in the same batch (34.0.3 / 33.0.8 / 32.0.14, 2026-08-13).
    // 34 is the newest of them, and 34.0.3-apache shares its digest with the
    // image's `latest`, `stable`, `production`, `apache` and `34-apache` tags
    // (all sha256:b97df9e0…, pushed 2026-09-02), so this pin IS the head of
    // the line, just spelled out. The pin is exact because the entrypoint
    // refuses to skip a major: an instance installed on 31 cannot jump
    // straight to 34, it has to be walked 31 -> 32 -> 33 -> 34, one image at
    // a time, so a floating tag would strand anyone who fell two behind.
    compose: `name: nextcloud
services:
  nextcloud:
    image: nextcloud:34.0.3-apache
    depends_on:
      - db
      - redis
    environment:
      NEXTCLOUD_TRUSTED_DOMAINS: \${NEXTCLOUD_TRUSTED_DOMAIN}
      NEXTCLOUD_ADMIN_USER: \${NEXTCLOUD_ADMIN_USER}
      NEXTCLOUD_ADMIN_PASSWORD: \${NEXTCLOUD_ADMIN_PASSWORD}
      POSTGRES_HOST: "\${{stack.db.HOST}}"
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      REDIS_HOST: "\${{stack.redis.HOST}}"
      OVERWRITEPROTOCOL: https
    ports:
      - "80"
    volumes:
      - nextcloud-html:/var/www/html
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - nextcloud-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nextcloud"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - nextcloud-redis:/data
    restart: always
volumes:
  nextcloud-html:
  nextcloud-db:
  nextcloud-redis:
`,
  },
  {
    id: "paperless-ngx",
    name: "Paperless-ngx",
    descriptionKey: "templates.catalog.paperless-ngx.description",
    category: "media",
    includes: ["webserver", "db", "broker", "gotenberg", "tika"],
    requiredEnv: [
      { key: "PAPERLESS_URL", descriptionKey: "templates.catalog.paperless-ngx.env.PAPERLESS_URL" },
      {
        key: "PAPERLESS_SECRET_KEY",
        descriptionKey: "templates.catalog.paperless-ngx.env.PAPERLESS_SECRET_KEY",
        generateHint: "openssl rand -base64 48",
      },
      {
        key: "PAPERLESS_ADMIN_USER",
        descriptionKey: "templates.catalog.paperless-ngx.env.PAPERLESS_ADMIN_USER",
      },
      {
        key: "PAPERLESS_ADMIN_PASSWORD",
        descriptionKey: "templates.catalog.paperless-ngx.env.PAPERLESS_ADMIN_PASSWORD",
        generateHint: "openssl rand -base64 18",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.paperless-ngx.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Paperless-ngx",
    docsUrl: "https://docs.paperless-ngx.com/setup/#docker",
    // Gotenberg and Tika are what let Paperless index office documents and
    // e-mail rather than only scans; the catalog ships Gotenberg standalone
    // too, but Paperless expects its OWN instance on a private port.
    // Tika is pinned, not floated: Tika 4.0.0 (which `latest` has pointed at
    // since 2026-08-22) dropped the /tika/form/* endpoints the bundled
    // tika-client still PUTs to, so every Office/.eml document fails to parse.
    // Upstream pinned 3.3.1 in v3.1.0 for the same reason (paperless-ngx#13755).
    compose: `name: paperless-ngx
services:
  webserver:
    image: ghcr.io/paperless-ngx/paperless-ngx:3.1.2
    depends_on:
      - db
      - broker
      - gotenberg
      - tika
    environment:
      PAPERLESS_URL: \${PAPERLESS_URL}
      PAPERLESS_SECRET_KEY: \${PAPERLESS_SECRET_KEY}
      PAPERLESS_ADMIN_USER: \${PAPERLESS_ADMIN_USER}
      PAPERLESS_ADMIN_PASSWORD: \${PAPERLESS_ADMIN_PASSWORD}
      PAPERLESS_TIME_ZONE: UTC
      PAPERLESS_DBENGINE: postgresql
      PAPERLESS_DBHOST: "\${{stack.db.HOST}}"
      PAPERLESS_DBNAME: paperless
      PAPERLESS_DBUSER: paperless
      PAPERLESS_DBPASS: \${POSTGRES_PASSWORD}
      PAPERLESS_REDIS: "redis://\${{stack.broker.HOST}}:6379"
      PAPERLESS_TIKA_ENABLED: "1"
      PAPERLESS_TIKA_ENDPOINT: "http://\${{stack.tika.HOST}}:9998"
      PAPERLESS_TIKA_GOTENBERG_ENDPOINT: "http://\${{stack.gotenberg.HOST}}:3000"
    ports:
      - "8000"
    volumes:
      - paperless-data:/usr/src/paperless/data
      - paperless-media:/usr/src/paperless/media
      - paperless-export:/usr/src/paperless/export
      - paperless-consume:/usr/src/paperless/consume
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: paperless
      POSTGRES_USER: paperless
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - paperless-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paperless"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
  broker:
    image: redis:7-alpine
    volumes:
      - paperless-redis:/data
    restart: always
  gotenberg:
    image: gotenberg/gotenberg:8.36
    command:
      - gotenberg
      - --chromium-disable-javascript=true
      - --chromium-allow-list=file:///tmp/.*
    restart: always
  tika:
    image: apache/tika:3.3.1.0-full
    restart: always
volumes:
  paperless-data:
  paperless-media:
  paperless-export:
  paperless-consume:
  paperless-db:
  paperless-redis:
`,
  },
];
