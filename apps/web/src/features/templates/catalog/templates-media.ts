// Photos, video, files, and scanned paper. See ./types.ts for the honesty
// contract.
import type { StackTemplate } from "./types";

export const MEDIA_TEMPLATES: StackTemplate[] = [
  {
    id: "immich",
    name: "Immich",
    descriptionKey: "templates.catalog.immich.description",
    category: "media",
    includes: ["immich-server", "immich-machine-learning", "database", "redis"],
    requiredEnv: [
      {
        key: "DB_PASSWORD",
        descriptionKey: "templates.catalog.immich.env.DB_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Immich",
    docsUrl: "https://docs.immich.app/install/docker-compose",
    // Immich needs Postgres with a vector extension, not stock Postgres: the
    // upstream `immich-app/postgres` image is the supported build and swapping
    // it for `postgres:16` fails at the first face/CLIP index. v3 dropped
    // pgvecto.rs entirely, so the extension has to be VectorChord (>=0.3 <2);
    // the tag below is the exact one upstream's own v3.1.0 compose pins.
    compose: `name: immich
services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:v3.1.0
    depends_on:
      - database
      - redis
    environment:
      DB_HOSTNAME: "\${{stack.database.HOST}}"
      DB_USERNAME: immich
      DB_PASSWORD: \${DB_PASSWORD}
      DB_DATABASE_NAME: immich
      REDIS_HOSTNAME: "\${{stack.redis.HOST}}"
      IMMICH_MACHINE_LEARNING_URL: "http://\${{stack.immich-machine-learning.HOST}}:3003"
    ports:
      - "2283"
    volumes:
      - immich-upload:/data
    restart: always
  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:v3.1.0
    volumes:
      - immich-model-cache:/cache
    restart: always
  database:
    image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0
    environment:
      POSTGRES_USER: immich
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: immich
      POSTGRES_INITDB_ARGS: "--data-checksums"
    volumes:
      - immich-db:/var/lib/postgresql/data
    restart: always
  redis:
    image: valkey/valkey:9-alpine
    healthcheck:
      test: ["CMD-SHELL", "valkey-cli ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  immich-upload:
  immich-model-cache:
  immich-db:
`,
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    descriptionKey: "templates.catalog.jellyfin.description",
    category: "media",
    includes: ["jellyfin"],
    requiredEnv: [
      { key: "JELLYFIN_URL", descriptionKey: "templates.catalog.jellyfin.env.JELLYFIN_URL" },
    ],
    logoBrand: "Jellyfin",
    docsUrl: "https://jellyfin.org/docs/general/installation/container",
    // The media volume starts empty and stays that way until something fills
    // it: this template gives Jellyfin a library directory, not a library.
    compose: `name: jellyfin
services:
  jellyfin:
    image: jellyfin/jellyfin:10.11.11
    environment:
      JELLYFIN_PublishedServerUrl: \${JELLYFIN_URL}
      TZ: UTC
    ports:
      - "8096"
    volumes:
      - jellyfin-config:/config
      - jellyfin-cache:/cache
      - jellyfin-media:/media
    restart: always
volumes:
  jellyfin-config:
  jellyfin-cache:
  jellyfin-media:
`,
  },
];
