// Chat front-ends for models you point at, hosted or local. See ./types.ts for
// the honesty contract.
import type { StackTemplate } from "./types";

export const AI_CHAT_TEMPLATES: StackTemplate[] = [
  {
    id: "librechat",
    name: "LibreChat",
    descriptionKey: "templates.catalog.librechat.description",
    category: "ai",
    includes: ["api", "mongodb", "meilisearch"],
    requiredEnv: [
      { key: "LIBRECHAT_URL", descriptionKey: "templates.catalog.librechat.env.LIBRECHAT_URL" },
      {
        key: "CREDS_KEY",
        descriptionKey: "templates.catalog.librechat.env.CREDS_KEY",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "CREDS_IV",
        descriptionKey: "templates.catalog.librechat.env.CREDS_IV",
        generateHint: "openssl rand -hex 16",
      },
      {
        key: "JWT_SECRET",
        descriptionKey: "templates.catalog.librechat.env.JWT_SECRET",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "JWT_REFRESH_SECRET",
        descriptionKey: "templates.catalog.librechat.env.JWT_REFRESH_SECRET",
        generateHint: "openssl rand -hex 32",
      },
      {
        key: "MEILI_MASTER_KEY",
        descriptionKey: "templates.catalog.librechat.env.MEILI_MASTER_KEY",
        generateHint: "openssl rand -base64 36",
      },
    ],
    logoBrand: "LibreChat",
    docsUrl: "https://www.librechat.ai/docs/local/docker",
    // Upstream's compose also carries a RAG service and an nginx front; neither
    // is required to run LibreChat, and both need files this platform would
    // have to bind-mount. Add provider API keys (OPENAI_API_KEY,
    // ANTHROPIC_API_KEY, …) as stack variables after the first deploy — or
    // point it at the catalog's own Ollama or LiteLLM stack.
    compose: `name: librechat
services:
  api:
    image: ghcr.io/danny-avila/librechat:v0.8.7
    depends_on:
      - mongodb
      - meilisearch
    environment:
      HOST: 0.0.0.0
      PORT: "3080"
      NODE_ENV: production
      DOMAIN_CLIENT: \${LIBRECHAT_URL}
      DOMAIN_SERVER: \${LIBRECHAT_URL}
      MONGO_URI: "mongodb://\${{stack.mongodb.HOST}}:27017/LibreChat"
      MEILI_HOST: "http://\${{stack.meilisearch.HOST}}:7700"
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
      SEARCH: "true"
      CREDS_KEY: \${CREDS_KEY}
      CREDS_IV: \${CREDS_IV}
      JWT_SECRET: \${JWT_SECRET}
      JWT_REFRESH_SECRET: \${JWT_REFRESH_SECRET}
      ALLOW_REGISTRATION: "true"
    ports:
      - "3080"
    volumes:
      - librechat-images:/app/client/public/images
      - librechat-uploads:/app/uploads
      - librechat-logs:/app/api/logs
    restart: always
  mongodb:
    image: mongo:8.0
    command: ["mongod", "--noauth"]
    volumes:
      - librechat-mongo:/data/db
    restart: always
  meilisearch:
    image: getmeili/meilisearch:v1.53
    environment:
      MEILI_NO_ANALYTICS: "true"
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
    volumes:
      - librechat-search:/meili_data
    restart: always
volumes:
  librechat-images:
  librechat-uploads:
  librechat-logs:
  librechat-mongo:
  librechat-search:
`,
  },
];
