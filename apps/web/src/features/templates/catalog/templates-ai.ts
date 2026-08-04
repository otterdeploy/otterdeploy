// AI templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const AI_TEMPLATES: StackTemplate[] = [
  {
    id: "open-webui",
    name: "Open WebUI + Ollama",
    description:
      "Self-hosted chat UI over a local Ollama runtime — models, prompts and history stay on your server. Pulls models on demand into a named volume; no external API key needed.",
    category: "ai",
    includes: ["open-webui", "ollama"],
    requiredEnv: [
      {
        key: "WEBUI_SECRET_KEY",
        description: "Signs session cookies. Changing it logs everyone out.",
      },
    ],
    logoBrand: "Ollama",
    docsUrl: "https://docs.openwebui.com/getting-started/quick-start/",
    compose: `name: open-webui
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    depends_on:
      - ollama
    environment:
      WEBUI_SECRET_KEY: \${WEBUI_SECRET_KEY}
      OLLAMA_BASE_URL: "http://ollama:11434"
      WEBUI_AUTH: "True"
    ports:
      - "8080"
    volumes:
      - open-webui-data:/app/backend/data
    restart: always
  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama-models:/root/.ollama
    restart: always
volumes:
  open-webui-data:
  ollama-models:
`,
  },
  {
    id: "litellm",
    name: "LiteLLM",
    description:
      "One OpenAI-compatible endpoint in front of every LLM provider — routing, budgets, keys and spend tracking. Backed by its own Postgres for keys and usage records.",
    category: "ai",
    includes: ["litellm", "db"],
    requiredEnv: [
      {
        key: "LITELLM_MASTER_KEY",
        description: "Admin key for the proxy — issues and revokes every other virtual key.",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the bundled Postgres that stores keys and spend.",
      },
    ],
    logoBrand: "LiteLLM",
    docsUrl: "https://docs.litellm.ai/docs/proxy/deploy",
    compose: `name: litellm
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    depends_on:
      - db
    environment:
      LITELLM_MASTER_KEY: \${LITELLM_MASTER_KEY}
      DATABASE_URL: "postgresql://litellm:\${POSTGRES_PASSWORD}@db:5432/litellm"
      STORE_MODEL_IN_DB: "True"
    ports:
      - "4000"
    restart: always
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: litellm
    volumes:
      - litellm-db:/var/lib/postgresql/data
    restart: always
volumes:
  litellm-db:
`,
  },
];
