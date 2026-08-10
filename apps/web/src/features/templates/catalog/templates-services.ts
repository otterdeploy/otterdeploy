// Small single-purpose services an app calls: headless browser, PDF rendering,
// realtime, MQTT, a DB console and a set of dev utilities.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const SERVICES_TEMPLATES: StackTemplate[] = [
  {
    id: "browserless",
    name: "Browserless",
    description:
      "Headless Chrome as a service. Point Puppeteer or Playwright at it over websocket for screenshots, PDFs and scraping, without shipping a browser inside your own image.",
    category: "devtools",
    includes: ["browserless"],
    requiredEnv: [
      {
        key: "BROWSERLESS_TOKEN",
        description: "Bearer token every connecting client must present.",
      },
    ],
    logoBrand: "Chromium",
    docsUrl: "https://docs.browserless.io/baas/docker/quickstart",
    compose: `name: browserless
services:
  browserless:
    image: ghcr.io/browserless/chromium:latest
    environment:
      TOKEN: \${BROWSERLESS_TOKEN}
      CONCURRENT: "\${BROWSERLESS_CONCURRENT:-5}"
      TIMEOUT: "\${BROWSERLESS_TIMEOUT:-60000}"
    ports:
      - "3000"
    restart: always
`,
  },
  {
    id: "gotenberg",
    name: "Gotenberg",
    description:
      "Stateless HTTP API that turns HTML, Markdown or Office documents into PDFs. Chromium and LibreOffice live in the container so your app never has to.",
    category: "devtools",
    includes: ["gotenberg"],
    requiredEnv: [],
    logoBrand: "Gotenberg",
    docsUrl: "https://gotenberg.dev/docs/getting-started/installation",
    compose: `name: gotenberg
services:
  gotenberg:
    image: gotenberg/gotenberg:8
    command:
      - gotenberg
      - --api-port=3000
      - --api-timeout=60s
    ports:
      - "3000"
    restart: always
`,
  },
  {
    id: "it-tools",
    name: "IT Tools",
    description:
      "The utility drawer: hash and JWT decoders, UUID and password generators, cron parsers, base64, regex testers, colour converters. Everything runs client-side once loaded.",
    category: "devtools",
    includes: ["it-tools"],
    requiredEnv: [],
    logoBrand: "IT Tools",
    docsUrl: "https://github.com/CorentinTh/it-tools",
    compose: `name: it-tools
services:
  it-tools:
    image: corentinth/it-tools:latest
    ports:
      - "80"
    restart: always
`,
  },
  {
    id: "drizzle-gateway",
    name: "Drizzle Gateway",
    description:
      "Self-hosted Drizzle Studio. Browse and edit any Postgres, MySQL or SQLite database in the browser, with the schema rendered the way Drizzle sees it.",
    category: "devtools",
    includes: ["drizzle-gateway"],
    requiredEnv: [
      {
        key: "GATEWAY_MASTERPASS",
        description: "Master password guarding the studio and its saved connections.",
      },
    ],
    logoBrand: "Drizzle",
    docsUrl: "https://orm.drizzle.team/docs/gateway",
    compose: `name: drizzle-gateway
services:
  drizzle-gateway:
    image: ghcr.io/drizzle-team/gateway:latest
    environment:
      STORE_PATH: /app
      MASTERPASS: \${GATEWAY_MASTERPASS}
    ports:
      - "4983"
    volumes:
      - drizzle-gateway-data:/app
    restart: always
volumes:
  drizzle-gateway-data:
`,
  },
  {
    id: "cloudbeaver",
    name: "CloudBeaver",
    description:
      "DBeaver in the browser: a full SQL console with schema navigation, ER diagrams and query history across Postgres, MySQL, SQLite and more, shared by a team.",
    category: "devtools",
    includes: ["cloudbeaver"],
    requiredEnv: [],
    logoBrand: "DBeaver",
    docsUrl: "https://dbeaver.com/docs/cloudbeaver/Run-Docker-Container/",
    compose: `name: cloudbeaver
services:
  cloudbeaver:
    image: dbeaver/cloudbeaver:24
    environment:
      CB_SERVER_NAME: "\${CB_SERVER_NAME:-CloudBeaver}"
    ports:
      - "8978"
    volumes:
      - cloudbeaver-workspace:/opt/cloudbeaver/workspace
    restart: always
volumes:
  cloudbeaver-workspace:
`,
  },
  {
    id: "soketi",
    name: "Soketi",
    description:
      "Pusher-compatible websocket server. Keep the Pusher client SDKs and point them here instead. Drop-in realtime for Laravel Echo, Rails and anything speaking the protocol.",
    category: "data",
    includes: ["soketi"],
    requiredEnv: [
      {
        key: "SOKETI_APP_KEY",
        description: "Public app key clients connect with.",
      },
      {
        key: "SOKETI_APP_SECRET",
        description: "Server-side secret used to sign channel authorization.",
      },
    ],
    logoBrand: "Soketi",
    docsUrl: "https://docs.soketi.app/getting-started/installation/docker",
    compose: `name: soketi
services:
  soketi:
    image: quay.io/soketi/soketi:1.6-16-debian
    environment:
      SOKETI_DEFAULT_APP_ID: "\${SOKETI_APP_ID:-app-id}"
      SOKETI_DEFAULT_APP_KEY: \${SOKETI_APP_KEY}
      SOKETI_DEFAULT_APP_SECRET: \${SOKETI_APP_SECRET}
      SOKETI_DEFAULT_APP_ENABLE_CLIENT_MESSAGES: "true"
      SOKETI_DEBUG: "0"
    ports:
      - "6001"
    restart: always
`,
  },
  {
    id: "mosquitto",
    name: "Mosquitto",
    description:
      "The reference MQTT broker: tiny, fast, and what most IoT and device fleets speak. Persists retained messages and subscriptions to a named volume.",
    category: "data",
    includes: ["mosquitto"],
    requiredEnv: [],
    logoBrand: "Eclipse Mosquitto",
    docsUrl: "https://mosquitto.org/man/mosquitto-conf-5.html",
    compose: `name: mosquitto
services:
  mosquitto:
    image: eclipse-mosquitto:2
    command:
      - sh
      - -c
      - "printf 'listener 1883\\\\nallow_anonymous true\\\\npersistence true\\\\npersistence_location /mosquitto/data/\\\\n' > /mosquitto/config/mosquitto.conf && exec mosquitto -c /mosquitto/config/mosquitto.conf"
    ports:
      - "1883"
    volumes:
      - mosquitto-data:/mosquitto/data
    restart: always
volumes:
  mosquitto-data:
`,
  },
  {
    id: "pocket-id",
    name: "Pocket ID",
    description:
      "OIDC provider built around passkeys, so there are no passwords to store or reset. Small enough to put in front of internal tools without running a full identity platform.",
    category: "security",
    includes: ["pocket-id"],
    requiredEnv: [
      {
        key: "APP_URL",
        description: "Public base URL. Issued tokens and OIDC discovery are built from it.",
      },
    ],
    logoBrand: "Pocket ID",
    docsUrl: "https://pocket-id.org/docs/setup/installation",
    compose: `name: pocket-id
services:
  pocket-id:
    image: ghcr.io/pocket-id/pocket-id:v1.13
    environment:
      APP_URL: \${APP_URL}
      TRUST_PROXY: "true"
    ports:
      - "1411"
    volumes:
      - pocket-id-data:/app/data
    restart: always
volumes:
  pocket-id-data:
`,
  },
];
