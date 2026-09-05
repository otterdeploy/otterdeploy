// Developer-infrastructure templates: registries, API tooling, a browser IDE.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

/**
 * Shipped in place of the image's own seed file.
 *
 * Verdaccio reads almost nothing from the environment (see
 * env-schemas/verdaccio.env.schema); config.yaml IS the configuration surface,
 * and there is no `${ENV}` interpolation in it at 6.10.2 either —
 * @verdaccio/config's `parseConfigFile` is a bare `js-yaml.load`. So a
 * template that wants to change any default has to ship the file.
 *
 * This is upstream's docker.yaml with the comment walls trimmed and exactly
 * two behavioural changes, both marked below. No `interpolate` flag: the file
 * holds no per-install secret, so it carries no `${VAR}` refs and needs no
 * prompt. Verdaccio generates and persists its own signing secret in
 * .verdaccio-db.json on the storage volume.
 */
const VERDACCIO_CONFIG = `# Verdaccio 6.10.2 configuration, shipped by the otterdeploy template.
#
# Derived from @verdaccio/config's docker.yaml (the file the image would seed
# if this one were absent), with two changes: self-registration is closed and
# anonymous access is removed. Everything else - storage paths, the npmjs
# uplink, the audit middleware, logging - is upstream's.
# Reference: https://verdaccio.org/docs/configuration

# Both paths sit under the verdaccio-storage volume / the image's own tree.
storage: /verdaccio/storage/data
plugins: /verdaccio/plugins

web:
  title: Verdaccio

# https://verdaccio.org/docs/plugin-auth
auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
    # CHANGE 1 of 2, and the reason this file exists. Upstream omits max_users,
    # which defaults to Infinity: any stranger who can reach the port runs
    # \`npm adduser\`, becomes $authenticated, and inherits publish AND unpublish
    # on every package pattern below. A negative value makes
    # PUT /-/user/... answer 409 "user registration disabled".
    #
    # The trade-off, verified rather than assumed: this closes \`npm adduser\`
    # for EVERYONE, including existing users, because the endpoint only takes
    # its login branch when the request already carries credentials. Create
    # the first account by appending to the htpasswd file on the storage
    # volume (openssl ships in the image; Verdaccio re-reads the file per
    # request, so no restart):
    #
    #   docker compose exec verdaccio sh -c \\
    #     'echo "alice:$(openssl passwd -apr1 CHOOSE_A_PASSWORD)" >> /verdaccio/storage/htpasswd'
    #
    # Then authenticate from the client with basic auth rather than npm login:
    #
    #   npm config set //REGISTRY_HOST/:_auth "$(printf 'alice:PASSWORD' | base64)"
    #
    # bcrypt, {SHA}, apr1 and crypt(3) hashes are all accepted.
    #
    # UPGRADING AN INSTANCE THAT WAS ALREADY EXPOSED: this closes new
    # registrations, it does not revoke old ones. Accounts created while the
    # permissive default was live survive in /verdaccio/storage/htpasswd and
    # keep working. Read that file and delete what you do not recognise.
    max_users: -1

# https://verdaccio.org/docs/uplinks
uplinks:
  npmjs:
    url: https://registry.npmjs.org/

# https://verdaccio.org/docs/packages
# CHANGE 2 of 2. Upstream ships \`access: $all\` on both patterns, i.e. anonymous
# clients may install anything this registry holds and pull anything through
# the uplink. $authenticated makes an open mirror a decision instead of a
# default; relax a pattern back to $all deliberately if that is what you want.
#
# \`proxy: npmjs\` stays on BOTH patterns on purpose. '@*/*' matches every scoped
# package, not only yours, so dropping the proxy there would break @types/* and
# every other public scoped dependency. To defend against dependency confusion,
# add a pattern for your own scope ABOVE these two, with no proxy line.
packages:
  '@*/*':
    access: $authenticated
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs

  '**':
    access: $authenticated
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs

# https://verdaccio.org/docs/configuration
server:
  keepAliveTimeout: 60

middlewares:
  audit:
    enabled: true

log:
  type: stdout
  format: pretty
  level: http

i18n:
  web: en-US
`;

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
  {
    id: "jaeger",
    name: "Jaeger",
    descriptionKey: "templates.catalog.jaeger.description",
    category: "observability",
    includes: ["jaeger"],
    requiredEnv: [],
    logoBrand: "Jaeger",
    docsUrl: "https://www.jaegertracing.io/docs/1.76/getting-started/",
    compose: `name: jaeger
services:
  jaeger:
    image: jaegertracing/all-in-one:1.76.0
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
      SPAN_STORAGE_TYPE: memory
    ports:
      - "16686"
      - "4317"
      - "4318"
    restart: always
`,
  },
  {
    id: "healthchecks",
    name: "Healthchecks",
    descriptionKey: "templates.catalog.healthchecks.description",
    category: "observability",
    includes: ["healthchecks", "db"],
    requiredEnv: [
      {
        key: "SITE_ROOT",
        descriptionKey: "templates.catalog.healthchecks.env.SITE_ROOT",
      },
      {
        key: "SECRET_KEY",
        descriptionKey: "templates.catalog.healthchecks.env.SECRET_KEY",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.healthchecks.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Healthchecks",
    docsUrl: "https://healthchecks.io/docs/self_hosted_docker/",
    compose: `name: healthchecks
services:
  healthchecks:
    image: healthchecks/healthchecks:v4.4
    depends_on:
      - db
    environment:
      SITE_ROOT: \${SITE_ROOT}
      SECRET_KEY: \${SECRET_KEY}
      DB: postgres
      DB_HOST: "\${{stack.db.HOST}}"
      DB_PORT: "5432"
      DB_NAME: healthchecks
      DB_USER: healthchecks
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      ALLOWED_HOSTS: "*"
      DEBUG: "False"
    ports:
      - "8000"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: healthchecks
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: healthchecks
    volumes:
      - healthchecks-db:/var/lib/postgresql/data
    restart: always
volumes:
  healthchecks-db:
`,
  },
];
