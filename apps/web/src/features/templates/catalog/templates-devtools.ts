// Developer-tooling templates: the things you run alongside your own app.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DEVTOOLS_TEMPLATES: StackTemplate[] = [
  {
    id: "pocketbase",
    name: "PocketBase",
    description:
      "Backend in a single file: SQLite database, auth, file storage and a realtime API, with an admin UI. Everything persists to one named volume; no external database to run.",
    category: "devtools",
    includes: ["pocketbase"],
    requiredEnv: [],
    logoBrand: "PocketBase",
    docsUrl: "https://pocketbase.io/docs/going-to-production/",
    compose: `name: pocketbase
services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    command:
      - serve
      - --http=0.0.0.0:8090
    ports:
      - "8090"
    volumes:
      - pocketbase-data:/pb_data
    restart: always
volumes:
  pocketbase-data:
`,
  },
  {
    id: "mailpit",
    name: "Mailpit",
    description:
      "SMTP server that captures mail instead of delivering it, with a web inbox to read it. Point a staging app's SMTP at it and nothing can reach a real customer by accident.",
    category: "devtools",
    includes: ["mailpit"],
    requiredEnv: [],
    logoBrand: "Mailpit",
    docsUrl: "https://mailpit.axllent.org/docs/install/docker/",
    compose: `name: mailpit
services:
  mailpit:
    image: axllent/mailpit:latest
    environment:
      MP_MAX_MESSAGES: "\${MP_MAX_MESSAGES:-5000}"
      MP_DATABASE: /data/mailpit.db
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
    ports:
      - "8025"
      - "1025"
    volumes:
      - mailpit-data:/data
    restart: always
volumes:
  mailpit-data:
`,
  },
  {
    id: "forgejo",
    name: "Forgejo",
    description:
      "The community fork of Gitea: a self-hosted Git forge with issues, pull requests and a package registry. Repositories live on a named volume, metadata in a bundled Postgres.",
    category: "devtools",
    includes: ["forgejo", "db"],
    requiredEnv: [
      {
        key: "FORGEJO_URL",
        description: "Public base URL. Used for clone URLs and webhook callbacks.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres.",
      },
    ],
    logoBrand: "Forgejo",
    docsUrl: "https://forgejo.org/docs/latest/admin/installation-docker/",
    compose: `name: forgejo
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:11
    depends_on:
      - db
    environment:
      FORGEJO__server__ROOT_URL: \${FORGEJO_URL}
      FORGEJO__database__DB_TYPE: postgres
      FORGEJO__database__HOST: "db:5432"
      FORGEJO__database__NAME: forgejo
      FORGEJO__database__USER: forgejo
      FORGEJO__database__PASSWD: \${POSTGRES_PASSWORD}
      USER_UID: "1000"
      USER_GID: "1000"
    ports:
      - "3000"
    volumes:
      - forgejo-data:/data
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: forgejo
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: forgejo
    volumes:
      - forgejo-db:/var/lib/postgresql/data
    restart: always
volumes:
  forgejo-data:
  forgejo-db:
`,
  },
  {
    id: "unleash",
    name: "Unleash",
    description:
      "Feature-flag service with gradual rollouts, targeting rules and per-environment toggles. SDK-driven, so flags evaluate in your app rather than over the network per request.",
    category: "devtools",
    includes: ["unleash", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres that stores flags and strategies.",
      },
    ],
    logoBrand: "Unleash",
    docsUrl: "https://docs.getunleash.io/using-unleash/deploy/getting-started",
    compose: `name: unleash
services:
  unleash:
    image: unleashorg/unleash-server:latest
    depends_on:
      - db
    environment:
      DATABASE_URL: "postgres://unleash:\${POSTGRES_PASSWORD}@db:5432/unleash"
      DATABASE_SSL: "false"
    ports:
      - "4242"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: unleash
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: unleash
    volumes:
      - unleash-db:/var/lib/postgresql/data
    restart: always
volumes:
  unleash-db:
`,
  },
];
