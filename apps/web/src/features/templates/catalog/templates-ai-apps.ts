// AI application templates: builders, RAG workspaces and inference-adjacent
// APIs. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const AI_APPS_TEMPLATES: StackTemplate[] = [
  {
    id: "flowise",
    name: "Flowise",
    descriptionKey: "templates.catalog.flowise.description",
    category: "ai",
    includes: ["flowise"],
    requiredEnv: [],
    logoBrand: "Flowise",
    docsUrl: "https://docs.flowiseai.com/getting-started",
    compose: `name: flowise
services:
  flowise:
    image: flowiseai/flowise:3.1.4
    environment:
      PORT: "3000"
      APP_URL: "\${{stack.flowise.PUBLIC_URL}}"
      DATABASE_PATH: /home/node/.flowise
      SECRETKEY_PATH: /home/node/.flowise
      BLOB_STORAGE_PATH: /home/node/.flowise/storage
      LOG_PATH: /home/node/logs
      EXPIRE_AUTH_TOKENS_ON_RESTART: "true"
    ports:
      - "3000"
    volumes:
      - flowise-data:/home/node
    restart: always
volumes:
  flowise-data:
`,
  },
  {
    id: "anythingllm",
    name: "AnythingLLM",
    descriptionKey: "templates.catalog.anythingllm.description",
    category: "ai",
    includes: ["anythingllm"],
    requiredEnv: [
      {
        key: "JWT_SECRET",
        descriptionKey: "templates.catalog.anythingllm.env.JWT_SECRET",
      },
    ],
    logoBrand: "AnythingLLM",
    docsUrl: "https://docs.anythingllm.com/installation-docker/quickstart",
    compose: `name: anythingllm
services:
  anythingllm:
    image: mintplexlabs/anythingllm:1.16.1
    environment:
      STORAGE_DIR: /app/server/storage
      JWT_SECRET: \${JWT_SECRET}
      DISABLE_TELEMETRY: "true"
    ports:
      - "3001"
    volumes:
      - anythingllm-storage:/app/server/storage
    restart: always
volumes:
  anythingllm-storage:
`,
  },
  {
    id: "libretranslate",
    name: "LibreTranslate",
    descriptionKey: "templates.catalog.libretranslate.description",
    category: "ai",
    includes: ["libretranslate"],
    requiredEnv: [],
    logoBrand: "LibreTranslate",
    docsUrl: "https://docs.libretranslate.com/guides/installation/",
    compose: `name: libretranslate
services:
  libretranslate:
    image: libretranslate/libretranslate:v1.9.6
    environment:
      LT_DISABLE_WEB_UI: "false"
      LT_LOAD_ONLY: "\${LT_LOAD_ONLY:-en,es,fr,de,pt}"
    ports:
      - "5000"
    volumes:
      - libretranslate-models:/home/libretranslate/.local
    restart: always
volumes:
  libretranslate-models:
`,
  },
  {
    id: "activepieces",
    name: "Activepieces",
    descriptionKey: "templates.catalog.activepieces.description",
    category: "automation",
    includes: ["activepieces", "db", "redis"],
    requiredEnv: [
      {
        key: "AP_FRONTEND_URL",
        descriptionKey: "templates.catalog.activepieces.env.AP_FRONTEND_URL",
      },
      {
        key: "AP_ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.activepieces.env.AP_ENCRYPTION_KEY",
      },
      {
        key: "AP_JWT_SECRET",
        descriptionKey: "templates.catalog.activepieces.env.AP_JWT_SECRET",
      },
      {
        key: "POSTGRES_PASSWORD",
        descriptionKey: "templates.catalog.activepieces.env.POSTGRES_PASSWORD",
      },
    ],
    logoBrand: "Activepieces",
    docsUrl: "https://www.activepieces.com/docs/install/options/docker-compose",
    compose: `name: activepieces
services:
  activepieces:
    image: ghcr.io/activepieces/activepieces:0.90.1
    depends_on:
      - db
      - redis
    environment:
      AP_FRONTEND_URL: \${AP_FRONTEND_URL}
      AP_ENCRYPTION_KEY: \${AP_ENCRYPTION_KEY}
      AP_JWT_SECRET: \${AP_JWT_SECRET}
      AP_POSTGRES_HOST: "\${{stack.db.HOST}}"
      AP_POSTGRES_PORT: "5432"
      AP_POSTGRES_DATABASE: activepieces
      AP_POSTGRES_USERNAME: activepieces
      AP_POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      AP_REDIS_HOST: "\${{stack.redis.HOST}}"
      AP_REDIS_PORT: "6379"
      AP_EXECUTION_MODE: "UNSANDBOXED"
      AP_TELEMETRY_ENABLED: "false"
    ports:
      - "80"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: activepieces
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: activepieces
    volumes:
      - activepieces-db:/var/lib/postgresql/data
    restart: always
  redis:
    image: redis:7-alpine
    volumes:
      - activepieces-redis:/data
    restart: always
volumes:
  activepieces-db:
  activepieces-redis:
`,
  },
];
