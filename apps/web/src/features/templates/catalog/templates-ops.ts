// Automation + observability templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const OPS_TEMPLATES: StackTemplate[] = [
  {
    id: "n8n",
    name: "n8n",
    description:
      "Fair-code workflow automation with 400+ integrations. Single service; workflows and credentials persist to a named volume (SQLite).",
    category: "automation",
    includes: ["n8n"],
    requiredEnv: [
      {
        key: "N8N_ENCRYPTION_KEY",
        description: "Encrypts stored credentials — losing it locks you out of them.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "WEBHOOK_URL",
        description: "Public base URL used when registering webhooks with external services.",
      },
    ],
    logoBrand: "n8n",
    docsUrl: "https://docs.n8n.io/hosting/installation/docker/",
    compose: `name: n8n
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    environment:
      N8N_ENCRYPTION_KEY: \${N8N_ENCRYPTION_KEY}
      WEBHOOK_URL: \${WEBHOOK_URL}
      GENERIC_TIMEZONE: \${TZ:-UTC}
    ports:
      - "5678"
    volumes:
      - n8n-data:/home/node/.n8n
    restart: always
volumes:
  n8n-data:
`,
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description:
      "Self-hosted uptime monitoring with status pages and notifications. Single service, zero required configuration — the first visit creates the admin user.",
    category: "observability",
    includes: ["uptime-kuma"],
    requiredEnv: [],
    logoBrand: "Uptime Kuma",
    docsUrl: "https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install",
    compose: `name: uptime-kuma
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    ports:
      - "3001"
    volumes:
      - uptime-kuma-data:/app/data
    healthcheck:
      test: ["CMD", "extra/healthcheck"]
      interval: 60s
      retries: 3
    restart: always
volumes:
  uptime-kuma-data:
`,
  },
  {
    id: "grafana-prometheus",
    name: "Grafana + Prometheus",
    description:
      "The canonical metrics stack: Prometheus scrapes and stores time series, Grafana dashboards them. Add scrape targets via Prometheus config after deploy.",
    category: "observability",
    includes: ["grafana", "prometheus"],
    requiredEnv: [
      {
        key: "GF_ADMIN_PASSWORD",
        description: "Password for the Grafana admin user.",
        generateHint: "openssl rand -base64 18",
      },
    ],
    logoBrand: "Grafana",
    docsUrl: "https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/",
    compose: `name: grafana
services:
  grafana:
    image: grafana/grafana-oss:11.2.0
    depends_on:
      - prometheus
    environment:
      GF_SECURITY_ADMIN_USER: \${GF_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: \${GF_ADMIN_PASSWORD}
    ports:
      - "3000"
    volumes:
      - grafana-data:/var/lib/grafana
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: always
  prometheus:
    image: prom/prometheus:v2.54.1
    volumes:
      - prometheus-data:/prometheus
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 -O - http://localhost:9090/-/healthy || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: always
volumes:
  grafana-data:
  prometheus-data:
`,
  },
];
