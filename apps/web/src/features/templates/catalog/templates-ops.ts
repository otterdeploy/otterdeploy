// Automation + observability templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const OPS_TEMPLATES: StackTemplate[] = [
  {
    id: "n8n",
    name: "n8n",
    descriptionKey: "templates.catalog.n8n.description",
    category: "automation",
    includes: ["n8n"],
    requiredEnv: [
      {
        key: "N8N_ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.n8n.env.N8N_ENCRYPTION_KEY",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "WEBHOOK_URL",
        descriptionKey: "templates.catalog.n8n.env.WEBHOOK_URL",
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
    descriptionKey: "templates.catalog.uptime-kuma.description",
    category: "observability",
    includes: ["uptime-kuma"],
    requiredEnv: [],
    logoBrand: "Uptime Kuma",
    docsUrl: "https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install",
    compose: `name: uptime-kuma
services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
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
    id: "beszel",
    name: "Beszel",
    descriptionKey: "templates.catalog.beszel.description",
    category: "observability",
    includes: ["beszel"],
    requiredEnv: [
      {
        key: "APP_URL",
        descriptionKey: "templates.catalog.beszel.env.APP_URL",
      },
    ],
    logoBrand: "Beszel",
    docsUrl: "https://beszel.dev/guide/getting-started",
    compose: `name: beszel
services:
  beszel:
    image: henrygd/beszel:0.18.8
    environment:
      APP_URL: \${APP_URL}
    ports:
      - "8090"
    volumes:
      - beszel-data:/beszel_data
    restart: always
volumes:
  beszel-data:
`,
  },
  {
    id: "grafana-prometheus",
    name: "Grafana + Prometheus",
    descriptionKey: "templates.catalog.grafana-prometheus.description",
    category: "observability",
    includes: ["grafana", "prometheus"],
    requiredEnv: [
      {
        key: "GF_ADMIN_PASSWORD",
        descriptionKey: "templates.catalog.grafana-prometheus.env.GF_ADMIN_PASSWORD",
        generateHint: "openssl rand -base64 18",
      },
    ],
    logoBrand: "Grafana",
    docsUrl: "https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/",
    compose: `name: grafana
services:
  grafana:
    image: grafana/grafana-oss:13.0.2
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
    image: prom/prometheus:v3.14.0
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
