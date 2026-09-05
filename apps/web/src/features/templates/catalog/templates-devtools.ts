// Developer-tooling templates: the things you run alongside your own app.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DEVTOOLS_TEMPLATES: StackTemplate[] = [
  {
    id: "pocketbase",
    name: "PocketBase",
    descriptionKey: "templates.catalog.pocketbase.description",
    category: "devtools",
    includes: ["pocketbase"],
    requiredEnv: [],
    logoBrand: "PocketBase",
    docsUrl: "https://pocketbase.io/docs/going-to-production/",
    compose: `name: pocketbase
services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:0.40.2
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
    descriptionKey: "templates.catalog.mailpit.description",
    category: "devtools",
    includes: ["mailpit"],
    requiredEnv: [],
    logoBrand: "Mailpit",
    docsUrl: "https://mailpit.axllent.org/docs/install/docker/",
    compose: `name: mailpit
services:
  mailpit:
    image: axllent/mailpit:v1.31.0
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
    descriptionKey: "templates.catalog.forgejo.description",
    category: "devtools",
    includes: ["forgejo", "db"],
    requiredEnv: [
      {
        key: "FORGEJO_URL",
        descriptionKey: "templates.catalog.forgejo.env.FORGEJO_URL",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.forgejo.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Forgejo",
    docsUrl: "https://forgejo.org/docs/v15.0/admin/installation/docker/",
    compose: `name: forgejo
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:15.0.7
    depends_on:
      - db
    environment:
      FORGEJO__server__ROOT_URL: \${FORGEJO_URL}
      FORGEJO__database__DB_TYPE: postgres
      FORGEJO__database__HOST: "\${{stack.db.HOST}}:5432"
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
    descriptionKey: "templates.catalog.unleash.description",
    category: "devtools",
    includes: ["unleash", "db"],
    requiredEnv: [
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.unleash.env.POSTGRES_PASSWORD",
      },
      {
        key: "UNLEASH_SECRET",
        descriptionKey: "templates.catalog.unleash.env.UNLEASH_SECRET",
        generateHint: "openssl rand -hex 32",
      },
    ],
    logoBrand: "Unleash",
    docsUrl: "https://docs.getunleash.io/deploy/getting-started",
    compose: `name: unleash
services:
  unleash:
    image: unleashorg/unleash-server:8.1.0
    depends_on:
      - db
    environment:
      DATABASE_URL: "postgres://unleash:\${POSTGRES_PASSWORD}@\${{stack.db.HOST}}:5432/unleash"
      DATABASE_SSL: "false"
      UNLEASH_URL: \${{stack.unleash.PUBLIC_URL}}
      UNLEASH_SECRET: \${UNLEASH_SECRET}
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
