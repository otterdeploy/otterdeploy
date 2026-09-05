// Developer-infrastructure templates: registries, API tooling, a browser IDE.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

import { VERDACCIO_CONFIG } from "./config-verdaccio";

export const DEVKIT_TEMPLATES: StackTemplate[] = [
  {
    id: "dozzle",
    name: "Dozzle",
    descriptionKey: "templates.catalog.dozzle.description",
    category: "devtools",
    includes: ["dozzle"],
    requiredEnv: [],
    logoBrand: "Docker",
    docsUrl: "https://dozzle.dev/guide/getting-started",
    compose: `name: dozzle
services:
  dozzle:
    image: amir20/dozzle:latest
    environment:
      DOZZLE_LEVEL: info
      DOZZLE_NO_ANALYTICS: "true"
    ports:
      - "8080"
    volumes:
      # Read-only, and read-only matters: the socket is root-equivalent on the
      # host, so :ro is the difference between "can read logs" and "can start a
      # privileged container". Dozzle only ever reads.
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: always
`,
  },
  {
    id: "verdaccio",
    name: "Verdaccio",
    descriptionKey: "templates.catalog.verdaccio.description",
    category: "devtools",
    includes: ["verdaccio"],
    requiredEnv: [],
    logoBrand: "Verdaccio",
    docsUrl: "https://verdaccio.org/docs/docker",
    // 6.10.2 (2026-09-02) rather than the matured 6.9.x line, because it is a
    // security release: it lifts ajv's `fast-uri` to 3.1.6, which closes four
    // high-severity URI-parser advisories (IDN host confusion, two SSRF paths
    // through IPv6/percent-decoding hostname normalization, percent-encoded
    // scheme confusion), clears the remaining `brace-expansion` ReDoS trees,
    // and starts validating the `:scope` segment on the web package endpoints.
    // 7.0.0 exists only as `-next` prereleases, so 6.x IS the current stable
    // line, not a legacy one.
    //
    // The tag was `6`. That float happens to resolve to 6.10.2 today
    // (sha256:09b40388..., pushed 2026-09-02, so it had not gone stale), but a
    // float means the registry a team locks its dependencies against can
    // change under them on any redeploy. Pinned to the patch.
    //
    // The conf directory was a named volume, which is why this template now
    // ships a config file instead. An empty named volume at /verdaccio/conf
    // gets seeded from the image, and the image's seed is
    // @verdaccio/config's docker.yaml — a deliberately permissive DEMO config.
    // Booted that way and measured on 6.10.2: `PUT /-/user/org.couchdb.user:x`
    // answers `201 user 'mallory' created` with a working token to an
    // unauthenticated stranger, and `GET /is-promise` answers `200` to nobody
    // at all. Since both package patterns carry `publish: $authenticated`,
    // that one call is the whole distance from "reachable" to "can overwrite
    // any package in your registry". A private registry cannot ship that.
    //
    // So: no conf volume, and VERDACCIO_CONFIG below is bound over
    // /verdaccio/conf/config.yaml. Keeping the named volume as well also
    // works (Docker applies the deeper mount last, so the bind wins), but it
    // leaves the 270-line permissive file sitting in the volume underneath,
    // invisible and live again the moment the bind is dropped. One file, one
    // source of truth. On an existing deploy the old conf volume is simply
    // orphaned; the storage volume, which holds the packages AND the htpasswd
    // file, is untouched and keeps its data.
    files: [{ path: "config.yaml", content: VERDACCIO_CONFIG }],
    compose: `name: verdaccio
services:
  verdaccio:
    image: verdaccio/verdaccio:6.10.2
    ports:
      - "4873"
    volumes:
      - verdaccio-storage:/verdaccio/storage
      - ./config.yaml:/verdaccio/conf/config.yaml
    restart: always
volumes:
  verdaccio-storage:
`,
  },
  {
    id: "docker-registry",
    name: "Docker Registry",
    descriptionKey: "templates.catalog.docker-registry.description",
    category: "devtools",
    includes: ["registry"],
    requiredEnv: [],
    logoBrand: "Docker",
    docsUrl: "https://distribution.github.io/distribution/about/deploying/",
    compose: `name: docker-registry
services:
  registry:
    image: registry:3
    environment:
      REGISTRY_STORAGE_DELETE_ENABLED: "true"
    ports:
      - "5000"
    volumes:
      - registry-data:/var/lib/registry
    restart: always
volumes:
  registry-data:
`,
  },
  {
    id: "hoppscotch",
    name: "Hoppscotch",
    descriptionKey: "templates.catalog.hoppscotch.description",
    category: "devtools",
    includes: ["hoppscotch", "db"],
    requiredEnv: [
      {
        key: "DATA_ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.hoppscotch.env.DATA_ENCRYPTION_KEY",
        // Hoppscotch runs `Buffer.from(key)` straight into an aes-256-cbc
        // cipher (src/utils.ts), so the key has to be exactly 32 CHARACTERS —
        // 31 or 33 throws at boot and takes the container with it. Standard
        // base64 of 24 bytes is 32 characters with no padding, which is why
        // the byte count here reads lower than the length it has to produce.
        generateHint: "openssl rand -base64 24",
        generate: { encoding: "base64", bytes: 24 },
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.hoppscotch.env.POSTGRES_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Hoppscotch",
    docsUrl:
      "https://docs.hoppscotch.io/documentation/self-host/community-edition/install-and-build",
    // Hoppscotch ships one calendar-versioned release a month. 2026.8.0 landed
    // 2026-08-28, six days before this pin; 2026.7.0 is the matured line: a
    // full cycle old with no follow-up patch release, which is how this project
    // signals a release that held. `latest` currently means 2026.8.0.
    //
    // `hoppscotch/hoppscotch` is the all-in-one Community Edition image: Caddy,
    // the NestJS backend and the desktop bundle server in one container. It
    // carries NO database, and the backend exits without DATABASE_URL or a
    // 32-character DATA_ENCRYPTION_KEY — aio_run.mjs then kills the container,
    // so the stack restart-loops rather than degrading. Hence the bundled
    // postgres:17-alpine below; the backend runs `prisma migrate deploy`
    // against it on every boot, so there is no separate migration service.
    //
    // ENABLE_SUBPATH_BASED_ACCESS is what makes this deployable on ONE domain.
    // The image's default multiport layout puts the app on 3000, the admin
    // dashboard on 3100 and the backend on 3170, and the edge routes a single
    // port — so the browser would load the app and then reach neither the API
    // nor the dashboard. Subpath mode serves all three from Caddy's port 80
    // under `/`, `/admin` and `/backend`, which also collapses them to one
    // origin, so WHITELISTED_ORIGINS is satisfied by the public URL alone. The
    // `app://` entries are what lets the Hoppscotch desktop app talk to this
    // instance; dropping them breaks only that client, silently.
    //
    // The VITE_* values are rewritten into the pre-built browser bundle by
    // aio_run.mjs at container start, so they re-resolve on every deploy
    // instead of freezing at install. VITE_BACKEND_WS_URL is built from DOMAIN
    // rather than PUBLIC_URL because it needs a `wss://` scheme, not `https://`.
    //
    // JWT_SECRET, SESSION_SECRET, the SMTP block and the SSO providers are NOT
    // env vars at this version: they are rows in the `infra_config` table,
    // generated on first boot and edited from the admin dashboard. See
    // hoppscotch.env.schema for the full surface.
    compose: `name: hoppscotch
services:
  hoppscotch:
    image: hoppscotch/hoppscotch:2026.7.0
    depends_on:
      - db
    environment:
      DATABASE_URL: "postgresql://hoppscotch:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/hoppscotch"
      DATA_ENCRYPTION_KEY: \${DATA_ENCRYPTION_KEY}
      ENABLE_SUBPATH_BASED_ACCESS: "true"
      WHITELISTED_ORIGINS: "\${{stack.hoppscotch.PUBLIC_URL}},app://localhost_3200,app://hoppscotch"
      VITE_BASE_URL: \${{stack.hoppscotch.PUBLIC_URL}}
      VITE_SHORTCODE_BASE_URL: \${{stack.hoppscotch.PUBLIC_URL}}
      VITE_ADMIN_URL: "\${{stack.hoppscotch.PUBLIC_URL}}/admin"
      VITE_BACKEND_GQL_URL: "\${{stack.hoppscotch.PUBLIC_URL}}/backend/graphql"
      VITE_BACKEND_WS_URL: "wss://\${{stack.hoppscotch.DOMAIN}}/backend/graphql"
      VITE_BACKEND_API_URL: "\${{stack.hoppscotch.PUBLIC_URL}}/backend/v1"
    ports:
      - "80"
    volumes:
      - hoppscotch-data:/data
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: hoppscotch
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: hoppscotch
    volumes:
      - hoppscotch-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hoppscotch"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  hoppscotch-data:
  hoppscotch-db:
`,
  },
  {
    id: "code-server",
    name: "code-server",
    descriptionKey: "templates.catalog.code-server.description",
    category: "devtools",
    includes: ["code-server"],
    requiredEnv: [
      {
        key: "CODE_SERVER_PASSWORD",
        descriptionKey: "templates.catalog.code-server.env.CODE_SERVER_PASSWORD",
      },
    ],
    logoBrand: "Visual Studio Code",
    docsUrl: "https://coder.com/docs/code-server/install#docker",
    compose: `name: code-server
services:
  code-server:
    image: codercom/code-server:4.135.0
    environment:
      PASSWORD: \${CODE_SERVER_PASSWORD}
    command:
      - --bind-addr
      - 0.0.0.0:8080
      - /home/coder/project
    ports:
      - "8080"
    volumes:
      - code-server-config:/home/coder/.config
      - code-server-project:/home/coder/project
    restart: always
volumes:
  code-server-config:
  code-server-project:
`,
  },
];
