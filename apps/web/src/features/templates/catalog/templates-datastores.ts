// Databases, caches, and search engines an app is pointed at. See ./types.ts
// for the honesty contract.
import type { StackTemplate } from "./types";

export const DATASTORE_TEMPLATES: StackTemplate[] = [
  {
    id: "clickhouse",
    name: "ClickHouse",
    descriptionKey: "templates.catalog.clickhouse.description",
    category: "data",
    includes: ["clickhouse"],
    requiredEnv: [
      {
        key: "CLICKHOUSE_PASSWORD",
        descriptionKey: "templates.catalog.clickhouse.env.CLICKHOUSE_PASSWORD",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "ClickHouse",
    docsUrl: "https://clickhouse.com/docs/install/docker",
    compose: `name: clickhouse
services:
  clickhouse:
    image: clickhouse/clickhouse-server:26.8
    environment:
      CLICKHOUSE_USER: clickhouse
      CLICKHOUSE_PASSWORD: \${CLICKHOUSE_PASSWORD}
      CLICKHOUSE_DB: default
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1"
    ports:
      - "8123"
      - "9000"
    volumes:
      - clickhouse-data:/var/lib/clickhouse
      - clickhouse-logs:/var/log/clickhouse-server
    restart: always
volumes:
  clickhouse-data:
  clickhouse-logs:
`,
  },
  {
    id: "qdrant",
    name: "Qdrant",
    descriptionKey: "templates.catalog.qdrant.description",
    category: "data",
    includes: ["qdrant"],
    requiredEnv: [
      {
        key: "QDRANT_API_KEY",
        descriptionKey: "templates.catalog.qdrant.env.QDRANT_API_KEY",
        generateHint: "openssl rand -base64 36",
      },
    ],
    logoBrand: "Qdrant",
    docsUrl: "https://qdrant.tech/documentation/guides/installation/",
    // Qdrant ships with NO authentication by default and its dashboard is a
    // full read/write client. The API key is required here rather than
    // optional because an exposed keyless instance is an open database.
    compose: `name: qdrant
services:
  qdrant:
    image: qdrant/qdrant:v1.13.4
    environment:
      QDRANT__SERVICE__API_KEY: \${QDRANT_API_KEY}
      QDRANT__SERVICE__ENABLE_TLS: "false"
      QDRANT__TELEMETRY_DISABLED: "true"
    ports:
      - "6333"
      - "6334"
    volumes:
      - qdrant-storage:/qdrant/storage
    restart: always
volumes:
  qdrant-storage:
`,
  },
  {
    id: "valkey",
    name: "Valkey",
    descriptionKey: "templates.catalog.valkey.description",
    category: "data",
    includes: ["valkey"],
    requiredEnv: [
      {
        key: "VALKEY_PASSWORD",
        descriptionKey: "templates.catalog.valkey.env.VALKEY_PASSWORD",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "Valkey",
    docsUrl: "https://valkey.io/topics/installation/",
    // `appendonly yes` is the difference between a cache and a datastore: the
    // default config keeps everything in memory and loses it on restart.
    //
    // Pinned to 8.1.10 (2026-08-31), the current 8.x line, rather than the
    // floating `8-alpine`. That release is a SECURITY release across every
    // supported line (GHSA-jcj7-v34w-v9vv, RDMA use-after-free — not reachable
    // in this image, which is built without USE_RDMA). Deliberately not on
    // 9.1.2: 9.x moved Lua scripting into a module and that new code just
    // produced GHSA-fq2f-crmw-q97r, an unauthenticated UAF of the interpreter
    // state escalatable to an indirect call, which the 8.x debugger is not
    // affected by. 8.1.10 has no open advisories.
    //
    // REDISCLI_AUTH is what makes the healthcheck work: valkey-cli is still
    // Redis-named internally, and without it `valkey-cli ping` answers "NOAUTH
    // Authentication required." against a requirepass server, so the grep never
    // matches and the container never reports healthy.
    compose: `name: valkey
services:
  valkey:
    image: valkey/valkey:8.1.10-alpine
    command:
      - valkey-server
      - --requirepass
      - \${VALKEY_PASSWORD}
      - --appendonly
      - "yes"
    environment:
      REDISCLI_AUTH: \${VALKEY_PASSWORD}
    ports:
      - "6379"
    volumes:
      - valkey-data:/data
    healthcheck:
      test: ["CMD-SHELL", "valkey-cli ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  valkey-data:
`,
  },
  {
    id: "typesense",
    name: "Typesense",
    descriptionKey: "templates.catalog.typesense.description",
    category: "data",
    includes: ["typesense"],
    requiredEnv: [
      {
        key: "TYPESENSE_API_KEY",
        descriptionKey: "templates.catalog.typesense.env.TYPESENSE_API_KEY",
        generateHint: "openssl rand -base64 36",
      },
    ],
    logoBrand: "Typesense",
    docsUrl: "https://typesense.org/docs/guide/install-typesense.html",
    compose: `name: typesense
services:
  typesense:
    image: typesense/typesense:28.0
    command:
      - --data-dir
      - /data
      - --api-key
      - \${TYPESENSE_API_KEY}
      - --enable-cors
    ports:
      - "8108"
    volumes:
      - typesense-data:/data
    restart: always
volumes:
  typesense-data:
`,
  },
  {
    id: "grist",
    name: "Grist",
    descriptionKey: "templates.catalog.grist.description",
    category: "data",
    includes: ["grist"],
    requiredEnv: [
      { key: "GRIST_URL", descriptionKey: "templates.catalog.grist.env.GRIST_URL" },
      {
        key: "GRIST_SESSION_SECRET",
        descriptionKey: "templates.catalog.grist.env.GRIST_SESSION_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "GRIST_DEFAULT_EMAIL",
        descriptionKey: "templates.catalog.grist.env.GRIST_DEFAULT_EMAIL",
      },
    ],
    logoBrand: "Grist",
    docsUrl: "https://support.getgrist.com/self-managed/",
    // `GRIST_SINGLE_ORG: docs` puts this install in single-team mode, which is
    // the shape that makes sense for one server. `GRIST_DEFAULT_EMAIL` is the
    // account that owns it — anyone signing in with that address is the owner.
    // Since 1.7.13 a fresh install boots "out of service": the container logs
    // print a one-time GRIST_BOOT_KEY, and /boot + that key unlocks the Quick
    // setup wizard. Set GRIST_IN_SERVICE=true to skip the gate entirely.
    compose: `name: grist
services:
  grist:
    image: gristlabs/grist:1.7.18
    environment:
      APP_HOME_URL: \${GRIST_URL}
      GRIST_SESSION_SECRET: \${GRIST_SESSION_SECRET}
      GRIST_DEFAULT_EMAIL: \${GRIST_DEFAULT_EMAIL}
      GRIST_SINGLE_ORG: docs
      GRIST_FORCE_LOGIN: "true"
      GRIST_SANDBOX_FLAVOR: gvisor
    ports:
      - "8484"
    volumes:
      - grist-persist:/persist
    restart: always
volumes:
  grist-persist:
`,
  },
];
