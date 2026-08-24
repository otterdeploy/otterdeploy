// Small single-purpose services an app calls: headless browser, PDF rendering,
// realtime, MQTT, a DB console and a set of dev utilities.
// See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const SERVICES_TEMPLATES: StackTemplate[] = [
  {
    id: "browserless",
    name: "Browserless",
    descriptionKey: "templates.catalog.browserless.description",
    category: "devtools",
    includes: ["browserless"],
    requiredEnv: [
      {
        key: "BROWSERLESS_TOKEN",
        descriptionKey: "templates.catalog.browserless.env.BROWSERLESS_TOKEN",
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
    descriptionKey: "templates.catalog.gotenberg.description",
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
    descriptionKey: "templates.catalog.it-tools.description",
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
    descriptionKey: "templates.catalog.drizzle-gateway.description",
    category: "devtools",
    includes: ["drizzle-gateway"],
    requiredEnv: [
      {
        key: "GATEWAY_MASTERPASS",
        descriptionKey: "templates.catalog.drizzle-gateway.env.GATEWAY_MASTERPASS",
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
    descriptionKey: "templates.catalog.cloudbeaver.description",
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
    descriptionKey: "templates.catalog.soketi.description",
    category: "data",
    includes: ["soketi"],
    requiredEnv: [
      {
        key: "SOKETI_APP_KEY",
        descriptionKey: "templates.catalog.soketi.env.SOKETI_APP_KEY",
      },
      {
        key: "SOKETI_APP_SECRET",
        descriptionKey: "templates.catalog.soketi.env.SOKETI_APP_SECRET",
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
    descriptionKey: "templates.catalog.mosquitto.description",
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
    descriptionKey: "templates.catalog.pocket-id.description",
    category: "security",
    includes: ["pocket-id"],
    requiredEnv: [
      {
        key: "APP_URL",
        descriptionKey: "templates.catalog.pocket-id.env.APP_URL",
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
