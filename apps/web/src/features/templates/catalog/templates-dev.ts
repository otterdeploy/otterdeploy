// Security + dev-tool templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const DEV_TEMPLATES: StackTemplate[] = [
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description:
      "Lightweight Bitwarden-compatible password server in Rust. Works with the official Bitwarden apps and browser extensions; data persists to a named volume.",
    category: "security",
    includes: ["vaultwarden"],
    requiredEnv: [
      {
        key: "DOMAIN",
        description: "Public URL the vault is served from — required for WebAuthn and the apps.",
      },
      {
        key: "ADMIN_TOKEN",
        description: "Token protecting the /admin panel.",
        generateHint: "openssl rand -base64 48",
      },
    ],
    logoBrand: "Vaultwarden",
    docsUrl: "https://github.com/dani-garcia/vaultwarden/wiki",
    compose: `name: vaultwarden
services:
  vaultwarden:
    image: vaultwarden/server:latest
    environment:
      DOMAIN: \${DOMAIN}
      ADMIN_TOKEN: \${ADMIN_TOKEN}
      SIGNUPS_ALLOWED: \${SIGNUPS_ALLOWED:-false}
    ports:
      - "80"
    volumes:
      - vaultwarden-data:/data
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 30s
      retries: 3
    restart: always
volumes:
  vaultwarden-data:
`,
  },
  {
    id: "gitea",
    name: "Gitea",
    description:
      "Self-hosted Git service — repos, issues, pull requests, and CI runners. Backed by Postgres; repositories persist to a named volume.",
    category: "devtools",
    includes: ["gitea", "db"],
    requiredEnv: [
      {
        key: "ROOT_URL",
        description: "Public URL Gitea is served from (clone URLs, webhooks, OAuth).",
      },
      {
        key: "POSTGRES_PASSWORD",
        description: "Password for the gitea Postgres user.",
        generateHint: "openssl rand -base64 24",
      },
    ],
    logoBrand: "Gitea",
    docsUrl: "https://docs.gitea.com/installation/install-with-docker",
    compose: `name: gitea
services:
  gitea:
    image: gitea/gitea:1.22
    depends_on:
      - db
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: db:5432
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: \${POSTGRES_PASSWORD}
      GITEA__server__ROOT_URL: \${ROOT_URL}
    ports:
      - "3000"
    volumes:
      - gitea-data:/data
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: gitea
    volumes:
      - gitea-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitea"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  gitea-data:
  gitea-db:
`,
  },
  {
    id: "excalidraw",
    name: "Excalidraw",
    description:
      "Virtual whiteboard with a hand-drawn feel. A single stateless container serving the editor — boards live in the browser unless exported.",
    category: "devtools",
    includes: ["excalidraw"],
    requiredEnv: [],
    logoBrand: "Excalidraw",
    docsUrl: "https://github.com/excalidraw/excalidraw/tree/master/docker",
    compose: `name: excalidraw
services:
  excalidraw:
    image: excalidraw/excalidraw:latest
    ports:
      - "80"
    restart: always
`,
  },
];
