// Templates — browseable starter-stack gallery. The "use template" wizard
// lives in new-service; this screen is the standalone catalog with a detail
// modal showing architecture, env vars, and a deploy CTA.

import * as React from "react";
import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";
import { TEMPLATES, PROJECT, type Template } from "../data";
import { SectionH } from "../components/form";

type Cat =
  | "all"
  | "ecommerce"
  | "cms"
  | "analytics"
  | "observability"
  | "auth"
  | "search"
  | "db"
  | "workflow"
  | "ai";

type Sort = "popular" | "newest" | "az";

type View = "grid" | "list";

interface IncludedSvc { name: string; image: string; cpu: number; mem: number }

type ExtendedTemplate = Template & {
  cat: Cat;
  installs: number;
  updated: string;
  description: string;
  includes: IncludedSvc[];
  envVars: Array<{ k: string; required: boolean; sample: string }>;
  readme: string;
  arch: { from: string; to: string }[];
};

const CATS: { id: Cat; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ecommerce", label: "E-commerce" },
  { id: "cms", label: "CMS" },
  { id: "analytics", label: "Analytics" },
  { id: "observability", label: "Observability" },
  { id: "auth", label: "Auth" },
  { id: "search", label: "Search" },
  { id: "db", label: "DB" },
  { id: "workflow", label: "Workflow" },
  { id: "ai", label: "AI" },
];

const EXTRA: ExtendedTemplate[] = [
  {
    id: "t-pocketbase",
    name: "PocketBase",
    sub: "Single-binary backend · auth · realtime · file storage",
    services: 1,
    icon: "db",
    cat: "auth",
    installs: 1860,
    updated: "3d ago",
    description:
      "PocketBase is a single Go binary that ships SQLite, an auth provider, file storage, and a realtime API. Great fit for prototypes and side projects that need persistence without a separate database container.",
    includes: [{ name: "PocketBase", image: "ghcr.io/pocketbase/pocketbase:0.22", cpu: 0.25, mem: 256 }],
    envVars: [
      { k: "PB_ADMIN_EMAIL", required: true, sample: "admin@helio.so" },
      { k: "PB_ADMIN_PASSWORD", required: true, sample: "•••••••" },
    ],
    readme: `# PocketBase\n\nDeploy with one container. Persistent volume mounted at /pb_data.\n\n  $ pocketbase serve --http=0.0.0.0:8090`,
    arch: [{ from: "internet", to: "pocketbase" }],
  },
  {
    id: "t-meilisearch",
    name: "Meilisearch",
    sub: "Typo-tolerant full-text search engine",
    services: 1,
    icon: "search",
    cat: "search",
    installs: 940,
    updated: "1w ago",
    description:
      "Meilisearch is a fast, typo-tolerant search server. Comes with a master key, persistent index volume, and the dashboard exposed on /.",
    includes: [{ name: "Meilisearch", image: "getmeili/meilisearch:v1.10", cpu: 0.5, mem: 512 }],
    envVars: [{ k: "MEILI_MASTER_KEY", required: true, sample: "•••••••" }],
    readme: `# Meilisearch\n\n  POST /indexes\n  { "uid": "documents" }`,
    arch: [{ from: "api", to: "meilisearch" }],
  },
  {
    id: "t-typesense",
    name: "Typesense",
    sub: "Open-source search engine · alternative to Algolia",
    services: 1,
    icon: "search",
    cat: "search",
    installs: 612,
    updated: "12d ago",
    description: "A fast, typo-tolerant search engine optimized for instant search experiences.",
    includes: [{ name: "Typesense", image: "typesense/typesense:0.27", cpu: 0.5, mem: 512 }],
    envVars: [{ k: "TYPESENSE_API_KEY", required: true, sample: "•••••••" }],
    readme: `# Typesense\n\n  curl -H "X-TYPESENSE-API-KEY: \${KEY}" /collections`,
    arch: [{ from: "api", to: "typesense" }],
  },
  {
    id: "t-keycloak",
    name: "Keycloak",
    sub: "Identity & access · OIDC · SAML · Postgres backed",
    services: 2,
    icon: "lock",
    cat: "auth",
    installs: 2240,
    updated: "5d ago",
    popular: true,
    description:
      "Keycloak provides single sign-on, identity brokering, and user federation. Backed by Postgres for production-grade persistence.",
    includes: [
      { name: "Keycloak", image: "quay.io/keycloak/keycloak:25", cpu: 1, mem: 1024 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
    ],
    envVars: [
      { k: "KC_ADMIN", required: true, sample: "admin" },
      { k: "KC_ADMIN_PASSWORD", required: true, sample: "•••••••" },
      { k: "KC_DB_URL", required: true, sample: "jdbc:postgresql://postgres:5432/keycloak" },
    ],
    readme: `# Keycloak\n\nDefault admin console at /admin.\n\n  bin/kc.sh start --hostname-strict=false`,
    arch: [
      { from: "internet", to: "keycloak" },
      { from: "keycloak", to: "postgres" },
    ],
  },
  {
    id: "t-nextcloud",
    name: "Nextcloud",
    sub: "Self-hosted file sync & collaboration",
    services: 3,
    icon: "folder",
    cat: "workflow",
    installs: 1108,
    updated: "2w ago",
    description: "Nextcloud is a content collaboration platform. Comes wired with Postgres for metadata and Redis for cache.",
    includes: [
      { name: "Nextcloud", image: "nextcloud:29-apache", cpu: 1, mem: 1024 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
      { name: "Redis 7", image: "redis:7", cpu: 0.25, mem: 256 },
    ],
    envVars: [
      { k: "NEXTCLOUD_ADMIN_USER", required: true, sample: "admin" },
      { k: "NEXTCLOUD_ADMIN_PASSWORD", required: true, sample: "•••••••" },
    ],
    readme: `# Nextcloud\n\nFirst-run wizard configures the admin user and database.`,
    arch: [
      { from: "internet", to: "nextcloud" },
      { from: "nextcloud", to: "postgres" },
      { from: "nextcloud", to: "redis" },
    ],
  },
  {
    id: "t-litellm",
    name: "LiteLLM Proxy",
    sub: "OpenAI-compatible LLM gateway · model routing · cost tracking",
    services: 2,
    icon: "bolt",
    cat: "ai",
    installs: 740,
    updated: "4d ago",
    description:
      "LiteLLM proxies hundreds of LLM providers behind one OpenAI-compatible API. Pairs with a Postgres instance to record per-key usage and costs.",
    includes: [
      { name: "LiteLLM", image: "ghcr.io/berriai/litellm:main-stable", cpu: 0.5, mem: 512 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
    ],
    envVars: [
      { k: "LITELLM_MASTER_KEY", required: true, sample: "sk-•••••••" },
      { k: "OPENAI_API_KEY", required: false, sample: "sk-•••••••" },
      { k: "ANTHROPIC_API_KEY", required: false, sample: "sk-ant-•••••••" },
    ],
    readme: `# LiteLLM\n\n  POST /v1/chat/completions\n  Authorization: Bearer \${LITELLM_MASTER_KEY}`,
    arch: [
      { from: "api", to: "litellm" },
      { from: "litellm", to: "postgres" },
    ],
  },
];

// extend the catalog with derived fields the gallery needs
const BASE_EXT: Record<string, Omit<ExtendedTemplate, keyof Template>> = {
  "t-medusa": {
    cat: "ecommerce",
    installs: 2310,
    updated: "1d ago",
    description:
      "Medusa is the open-source Shopify alternative — a headless commerce engine with admin UI, plugin system, and built-in payment / shipping primitives.",
    includes: [
      { name: "Medusa", image: "medusajs/medusa:1.20", cpu: 1, mem: 1024 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
      { name: "Redis 7", image: "redis:7", cpu: 0.25, mem: 256 },
      { name: "Admin UI", image: "medusajs/admin:7", cpu: 0.25, mem: 256 },
    ],
    envVars: [
      { k: "DATABASE_URL", required: true, sample: "postgres://medusa:•••@postgres:5432/medusa" },
      { k: "REDIS_URL", required: true, sample: "redis://redis:6379" },
      { k: "JWT_SECRET", required: true, sample: "•••••••" },
      { k: "COOKIE_SECRET", required: true, sample: "•••••••" },
    ],
    readme: `# Medusa Commerce\n\n  $ medusa develop\n\nAdmin → /app · Storefront API → /store`,
    arch: [
      { from: "internet", to: "medusa" },
      { from: "internet", to: "admin" },
      { from: "medusa", to: "postgres" },
      { from: "medusa", to: "redis" },
      { from: "admin", to: "medusa" },
    ],
  },
  "t-supabase": {
    cat: "auth",
    installs: 4120,
    updated: "6h ago",
    description:
      "Supabase is the open-source Firebase alternative. This stack provisions auth, database, realtime, storage, and the Studio dashboard.",
    includes: [
      { name: "Postgres 16", image: "supabase/postgres:15.6", cpu: 1, mem: 1024 },
      { name: "Auth (gotrue)", image: "supabase/gotrue:v2", cpu: 0.25, mem: 256 },
      { name: "PostgREST", image: "postgrest/postgrest:v12", cpu: 0.25, mem: 256 },
      { name: "Realtime", image: "supabase/realtime:v2", cpu: 0.25, mem: 256 },
      { name: "Storage", image: "supabase/storage-api:v1", cpu: 0.25, mem: 256 },
      { name: "Studio", image: "supabase/studio:latest", cpu: 0.25, mem: 256 },
    ],
    envVars: [
      { k: "JWT_SECRET", required: true, sample: "•••••••" },
      { k: "ANON_KEY", required: true, sample: "eyJhbGc•••" },
      { k: "SERVICE_ROLE_KEY", required: true, sample: "eyJhbGc•••" },
    ],
    readme: `# Supabase\n\n  Studio → /studio\n  REST → /rest/v1\n  Realtime → /realtime/v1`,
    arch: [
      { from: "internet", to: "studio" },
      { from: "studio", to: "auth" },
      { from: "studio", to: "rest" },
      { from: "auth", to: "postgres" },
      { from: "rest", to: "postgres" },
      { from: "realtime", to: "postgres" },
    ],
  },
  "t-strapi": {
    cat: "cms",
    installs: 1820,
    updated: "9d ago",
    description: "Strapi is a Node-based headless CMS with a customizable admin UI. Backed by Postgres in this template.",
    includes: [
      { name: "Strapi", image: "strapi/strapi:4", cpu: 1, mem: 1024 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
    ],
    envVars: [
      { k: "DATABASE_URL", required: true, sample: "postgres://strapi:•••@postgres:5432/strapi" },
      { k: "ADMIN_JWT_SECRET", required: true, sample: "•••••••" },
    ],
    readme: `# Strapi\n\n  Admin → /admin\n  Content API → /api`,
    arch: [
      { from: "internet", to: "strapi" },
      { from: "strapi", to: "postgres" },
    ],
  },
  "t-ghost": {
    cat: "cms",
    installs: 980,
    updated: "11d ago",
    description: "Ghost is a Node-based publishing platform — newsletters, members, and a clean editor.",
    includes: [
      { name: "Ghost", image: "ghost:5", cpu: 0.5, mem: 512 },
      { name: "MySQL 8", image: "mysql:8", cpu: 0.5, mem: 512 },
    ],
    envVars: [
      { k: "url", required: true, sample: "https://blog.helio.so" },
      { k: "database__connection__password", required: true, sample: "•••••••" },
    ],
    readme: `# Ghost\n\n  Admin → /ghost`,
    arch: [
      { from: "internet", to: "ghost" },
      { from: "ghost", to: "mysql" },
    ],
  },
  "t-nocodb": {
    cat: "db",
    installs: 1240,
    updated: "5d ago",
    description: "NocoDB turns any database into a smart spreadsheet — Airtable-style UI on top of Postgres.",
    includes: [
      { name: "NocoDB", image: "nocodb/nocodb:latest", cpu: 0.5, mem: 512 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
    ],
    envVars: [{ k: "NC_DB", required: true, sample: "pg://postgres:5432?u=nocodb&p=•••&d=nocodb" }],
    readme: `# NocoDB\n\n  Dashboard → /dashboard`,
    arch: [
      { from: "internet", to: "nocodb" },
      { from: "nocodb", to: "postgres" },
    ],
  },
  "t-plausible": {
    cat: "analytics",
    installs: 2890,
    updated: "2d ago",
    description: "Plausible is a privacy-friendly Google Analytics alternative. ClickHouse for events, Postgres for app state.",
    includes: [
      { name: "Plausible", image: "plausible/analytics:v2", cpu: 0.5, mem: 512 },
      { name: "ClickHouse", image: "clickhouse/clickhouse-server:24", cpu: 1, mem: 1024 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
    ],
    envVars: [
      { k: "BASE_URL", required: true, sample: "https://analytics.helio.so" },
      { k: "SECRET_KEY_BASE", required: true, sample: "•••••••" },
    ],
    readme: `# Plausible\n\nFirst-run wizard creates the admin user.`,
    arch: [
      { from: "internet", to: "plausible" },
      { from: "plausible", to: "postgres" },
      { from: "plausible", to: "clickhouse" },
    ],
  },
  "t-umami": {
    cat: "analytics",
    installs: 1640,
    updated: "10d ago",
    description: "Umami is a simple, fast, privacy-focused alternative to Google Analytics.",
    includes: [
      { name: "Umami", image: "ghcr.io/umami-software/umami:postgresql-v2", cpu: 0.25, mem: 256 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
    ],
    envVars: [
      { k: "DATABASE_URL", required: true, sample: "postgres://umami:•••@postgres:5432/umami" },
      { k: "APP_SECRET", required: true, sample: "•••••••" },
    ],
    readme: `# Umami\n\n  Dashboard → /\n  Tracking script → /script.js`,
    arch: [
      { from: "internet", to: "umami" },
      { from: "umami", to: "postgres" },
    ],
  },
  "t-n8n": {
    cat: "workflow",
    installs: 3210,
    updated: "1d ago",
    description: "n8n is a fair-code workflow automation tool — connect anything to anything with 400+ nodes.",
    includes: [{ name: "n8n", image: "n8nio/n8n:latest", cpu: 0.5, mem: 512 }],
    envVars: [
      { k: "N8N_BASIC_AUTH_USER", required: true, sample: "admin" },
      { k: "N8N_BASIC_AUTH_PASSWORD", required: true, sample: "•••••••" },
    ],
    readme: `# n8n\n\n  Editor → /\n  Webhook → /webhook/<path>`,
    arch: [{ from: "internet", to: "n8n" }],
  },
  "t-grafana": {
    cat: "observability",
    installs: 5120,
    updated: "8h ago",
    description: "Grafana + Prometheus + Loki — the canonical observability stack for metrics and logs.",
    includes: [
      { name: "Grafana", image: "grafana/grafana:11", cpu: 0.25, mem: 256 },
      { name: "Prometheus", image: "prom/prometheus:v2.54", cpu: 0.5, mem: 512 },
      { name: "Loki", image: "grafana/loki:3", cpu: 0.5, mem: 512 },
    ],
    envVars: [{ k: "GF_SECURITY_ADMIN_PASSWORD", required: true, sample: "•••••••" }],
    readme: `# Grafana stack\n\n  Grafana → /\n  Prometheus → /prometheus\n  Loki → tail logs`,
    arch: [
      { from: "internet", to: "grafana" },
      { from: "grafana", to: "prometheus" },
      { from: "grafana", to: "loki" },
    ],
  },
  "t-langfuse": {
    cat: "ai",
    installs: 1490,
    updated: "3d ago",
    description: "Langfuse is open-source LLM engineering — tracing, prompt management, and evals.",
    includes: [
      { name: "Langfuse", image: "langfuse/langfuse:2", cpu: 0.5, mem: 512 },
      { name: "Postgres 16", image: "postgres:16", cpu: 0.5, mem: 512 },
      { name: "ClickHouse", image: "clickhouse/clickhouse-server:24", cpu: 1, mem: 1024 },
    ],
    envVars: [
      { k: "DATABASE_URL", required: true, sample: "postgres://langfuse:•••@postgres:5432/langfuse" },
      { k: "NEXTAUTH_SECRET", required: true, sample: "•••••••" },
      { k: "SALT", required: true, sample: "•••••••" },
    ],
    readme: `# Langfuse\n\n  UI → /\n  Ingest API → /api/public/ingestion`,
    arch: [
      { from: "internet", to: "langfuse" },
      { from: "langfuse", to: "postgres" },
      { from: "langfuse", to: "clickhouse" },
    ],
  },
};

const ALL_TEMPLATES: ExtendedTemplate[] = [
  ...TEMPLATES.map((t) => ({ ...t, ...(BASE_EXT[t.id] ?? BASE_EXT["t-strapi"]!) })),
  ...EXTRA,
];

const ICON_FOR_CAT: Record<Cat, keyof typeof I> = {
  all: "scale",
  ecommerce: "service",
  cms: "doc",
  analytics: "metrics",
  observability: "metrics",
  auth: "lock",
  search: "search",
  db: "db",
  workflow: "bolt",
  ai: "bolt",
};

function TplIcon({ icon }: { icon: string }) {
  const dict = I as unknown as Record<string, ((p: { width?: number; height?: number }) => React.JSX.Element) | undefined>;
  const Comp = dict[icon];
  if (Comp) return <Comp width={16} height={16} />;
  return <I.doc width={16} height={16} />;
}

export function Templates() {
  const [cat, setCat] = useState<Cat>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("popular");
  const [view, setView] = useState<View>("grid");
  const [open, setOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const base = ALL_TEMPLATES.filter((t) => (cat === "all" ? true : t.cat === cat)).filter((t) => {
      if (!q.trim()) return true;
      const needle = q.toLowerCase();
      return t.name.toLowerCase().includes(needle) || t.sub.toLowerCase().includes(needle);
    });
    if (sort === "az") return [...base].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "newest") return [...base].sort((a, b) => a.updated.localeCompare(b.updated));
    return [...base].sort((a, b) => b.installs - a.installs);
  }, [cat, q, sort]);

  const opening = open ? ALL_TEMPLATES.find((t) => t.id === open) ?? null : null;

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}>
        <div>
          <div className="row" style={{ marginBottom: 14 }}>
            <SectionH
              title="Templates"
              sub="One-click stacks. Each template provisions multiple services with sane defaults."
            />
            <div style={{ flex: 1 }} />
            <button className="btn ghost sm">
              <I.upload width={11} height={11} /> Submit a template
            </button>
          </div>

          <div className="row gap-2" style={{ marginBottom: 12, flexWrap: "wrap" }}>
            <div
              className="row gap-1"
              style={{
                background: "var(--bg-sunken)",
                padding: 3,
                borderRadius: 6,
                border: "1px solid var(--border)",
                display: "inline-flex",
                flexWrap: "wrap",
              }}
            >
              {CATS.map((c) => {
                const active = cat === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCat(c.id)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      borderRadius: 4,
                      background: active ? "var(--bg-elev)" : "transparent",
                      color: active ? "var(--fg)" : "var(--fg-3)",
                      fontWeight: active ? 500 : 400,
                      cursor: "pointer",
                      boxShadow: active ? "var(--shadow-sm)" : "none",
                      border: 0,
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            <div className="row gap-2">
              <div style={{ position: "relative" }}>
                <I.search
                  width={11}
                  height={11}
                  style={{ position: "absolute", top: "50%", left: 8, transform: "translateY(-50%)", color: "var(--fg-3)" }}
                />
                <input
                  className="input"
                  placeholder="Search templates"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ paddingLeft: 24, height: 28, width: 200, fontSize: 12 }}
                />
              </div>
              <select
                className="input"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                style={{ height: 28, padding: "0 8px", fontSize: 12 }}
              >
                <option value="popular">Most popular</option>
                <option value="newest">Newest</option>
                <option value="az">A → Z</option>
              </select>
              <div
                className="row gap-1"
                style={{
                  background: "var(--bg-sunken)",
                  padding: 2,
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                }}
              >
                <button
                  className="btn ghost sm icon"
                  onClick={() => setView("grid")}
                  style={{ background: view === "grid" ? "var(--bg-elev)" : "transparent" }}
                >
                  <I.scale width={11} height={11} />
                </button>
                <button
                  className="btn ghost sm icon"
                  onClick={() => setView("list")}
                  style={{ background: view === "list" ? "var(--bg-elev)" : "transparent" }}
                >
                  <I.log width={11} height={11} />
                </button>
              </div>
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--fg-3)", fontSize: 12 }}>
              No templates match this filter.
            </div>
          )}

          {view === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {filtered.map((t) => (
                <TemplateCard key={t.id} t={t} onOpen={() => setOpen(t.id)} />
              ))}
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {filtered.map((t, i) => (
                <TemplateRow key={t.id} t={t} borderTop={i > 0} onOpen={() => setOpen(t.id)} />
              ))}
            </div>
          )}
        </div>

        <RightRail onPick={(id) => setCat(id)} />
      </div>

      {opening && <TemplateDetail t={opening} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TemplateCard({ t, onOpen }: { t: ExtendedTemplate; onOpen: () => void }) {
  return (
    <div
      className="card"
      style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}
    >
      <div
        className="row"
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-sunken)",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            display: "grid",
            placeItems: "center",
            color: "var(--fg-2)",
          }}
        >
          <TplIcon icon={t.icon} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
        {t.popular && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "2px 6px",
              borderRadius: 3,
              background: "var(--info-bg)",
              color: "var(--info)",
            }}
          >
            ★ popular
          </span>
        )}
      </div>
      <div className="col gap-3" style={{ padding: 14, flex: 1 }}>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
          {t.sub}
        </div>
        <div>
          <div
            className="muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}
          >
            Includes
          </div>
          <div className="row gap-1" style={{ flexWrap: "wrap" }}>
            {t.includes.map((s) => (
              <span
                key={s.name}
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "var(--bg-overlay)",
                  color: "var(--fg-2)",
                }}
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>
        <div className="row gap-3" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: "auto" }}>
          <span className="row gap-1">
            <I.service width={10} height={10} /> {t.services} services
          </span>
          <span className="row gap-1">
            <I.download width={10} height={10} /> deployed {(t.installs / 1000).toFixed(1)}k times
          </span>
          <span className="row gap-1">
            <I.clock width={10} height={10} /> {t.updated}
          </span>
        </div>
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={onOpen}>
          Use template <I.chev width={11} height={11} />
        </button>
      </div>
    </div>
  );
}

function TemplateRow({
  t,
  borderTop,
  onOpen,
}: {
  t: ExtendedTemplate;
  borderTop: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      className="row gap-3"
      style={{ padding: "12px 14px", borderTop: borderTop ? "1px solid var(--border)" : "none", fontSize: 12 }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: "var(--bg-sunken)",
          display: "grid",
          placeItems: "center",
          color: "var(--fg-2)",
        }}
      >
        <TplIcon icon={t.icon} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row gap-2">
          <span style={{ fontWeight: 600 }}>{t.name}</span>
          {t.popular && (
            <span style={{ fontSize: 9, color: "var(--info)" }}>★ popular</span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {t.sub}
        </div>
      </div>
      <span className="muted mono" style={{ fontSize: 11 }}>
        {t.services} svc
      </span>
      <span className="muted mono" style={{ fontSize: 11 }}>
        {(t.installs / 1000).toFixed(1)}k
      </span>
      <span className="muted" style={{ fontSize: 11 }}>
        {t.updated}
      </span>
      <button className="btn primary sm" onClick={onOpen}>
        Use <I.chev width={10} height={10} />
      </button>
    </div>
  );
}

function RightRail({ onPick }: { onPick: (c: Cat) => void }) {
  return (
    <div style={{ position: "sticky", top: 0, alignSelf: "start" }}>
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div
          className="muted"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}
        >
          Popular categories
        </div>
        <div className="col gap-1">
          {(["ecommerce", "cms", "observability", "ai", "auth"] as Cat[]).map((c) => {
            const Icon = I[ICON_FOR_CAT[c]] as (p: { width?: number; height?: number }) => React.JSX.Element;
            return (
              <button
                key={c}
                className="row gap-2"
                onClick={() => onPick(c)}
                style={{
                  padding: "6px 8px",
                  border: 0,
                  borderRadius: 4,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--fg-2)",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-overlay)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Icon width={11} height={11} />
                {CATS.find((x) => x.id === c)?.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div
          className="muted"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}
        >
          Recently added
        </div>
        <div className="col gap-2">
          {ALL_TEMPLATES.slice(-3).map((t) => (
            <div key={t.id} className="row gap-2" style={{ fontSize: 12 }}>
              <TplIcon icon={t.icon} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{t.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {t.updated}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div
          className="muted"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}
        >
          Trending this week
        </div>
        <div className="col gap-2">
          {[...ALL_TEMPLATES]
            .sort((a, b) => b.installs - a.installs)
            .slice(0, 4)
            .map((t, i) => (
              <div key={t.id} className="row gap-2" style={{ fontSize: 12 }}>
                <span className="mono muted" style={{ width: 14, fontSize: 10 }}>
                  #{i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: 500 }}>{t.name}</span>
                <span className="mono muted" style={{ fontSize: 10 }}>
                  {(t.installs / 1000).toFixed(1)}k
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function TemplateDetail({ t, onClose }: { t: ExtendedTemplate; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width: 880, maxHeight: "86vh" }}>
        <div className="row gap-2 os-modal-h">
          <TplIcon icon={t.icon} />
          <span style={{ fontWeight: 600 }}>{t.name}</span>
          {t.popular && (
            <span
              style={{
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 3,
                background: "var(--info-bg)",
                color: "var(--info)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              popular
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div className="os-scroll col gap-4" style={{ padding: 18, overflow: "auto", flex: 1 }}>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6 }}>{t.description}</div>

          <Section title="Architecture">
            <ArchDiagram services={t.includes.map((s) => s.name)} edges={t.arch} />
          </Section>

          <Section title="Included services">
            <div className="card" style={{ overflow: "hidden" }}>
              <div
                className="row"
                style={{
                  padding: "8px 12px",
                  background: "var(--bg-sunken)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--fg-3)",
                }}
              >
                <span style={{ flex: 1 }}>Service</span>
                <span style={{ width: 220 }}>Image</span>
                <span style={{ width: 80, textAlign: "right" }}>CPU</span>
                <span style={{ width: 80, textAlign: "right" }}>Memory</span>
              </div>
              {t.includes.map((s, i) => (
                <div
                  key={s.name}
                  className="row"
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                  <span className="mono muted" style={{ width: 220, fontSize: 11 }}>
                    {s.image}
                  </span>
                  <span className="mono" style={{ width: 80, textAlign: "right" }}>
                    {s.cpu} vCPU
                  </span>
                  <span className="mono" style={{ width: 80, textAlign: "right" }}>
                    {s.mem} MB
                  </span>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Total estimate:{" "}
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {t.includes.reduce((a, b) => a + b.cpu, 0).toFixed(2)} vCPU ·{" "}
                {t.includes.reduce((a, b) => a + b.mem, 0)} MB
              </span>
            </div>
          </Section>

          <Section title="Environment variables">
            <div className="card" style={{ overflow: "hidden" }}>
              {t.envVars.map((v, i) => (
                <div
                  key={v.k}
                  className="row"
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <span className="mono" style={{ width: 220, fontWeight: 500 }}>
                    {v.k}
                  </span>
                  <span style={{ width: 60 }}>
                    {v.required ? (
                      <span className="badge err" style={{ fontSize: 9 }}>
                        required
                      </span>
                    ) : (
                      <span className="badge" style={{ fontSize: 9 }}>
                        optional
                      </span>
                    )}
                  </span>
                  <span className="mono muted" style={{ flex: 1, fontSize: 11 }}>
                    {v.sample}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="README">
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                background: "var(--bg-sunken)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 11.5,
                lineHeight: 1.7,
                color: "var(--fg-2)",
                whiteSpace: "pre-wrap",
              }}
            >
              {t.readme}
            </pre>
          </Section>
        </div>

        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Will provision {t.includes.length} service{t.includes.length === 1 ? "" : "s"} in{" "}
            <span className="mono" style={{ color: "var(--fg-2)" }}>
              {PROJECT.name}
            </span>
            .
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">
            <I.rocket width={11} height={11} /> Deploy in this project
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="muted"
        style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ArchDiagram({ services, edges }: { services: string[]; edges: { from: string; to: string }[] }) {
  // Lay out services in a grid; draw arrows between them.
  const nodes = useMemo(() => {
    const list = ["internet", ...services];
    const cols = Math.min(4, list.length);
    return list.map((name, i) => ({
      name,
      x: 24 + (i % cols) * 180,
      y: 24 + Math.floor(i / cols) * 80,
    }));
  }, [services]);

  const w = 24 + 4 * 180;
  const h = Math.max(120, 24 + Math.ceil(nodes.length / 4) * 80 + 40);

  const find = (name: string) =>
    nodes.find((n) => n.name === name || n.name.toLowerCase().includes(name.toLowerCase()));

  return (
    <div
      className="card"
      style={{ padding: 12, background: "var(--bg-sunken)", overflow: "auto" }}
    >
      <svg width={w} height={h} style={{ display: "block" }}>
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--fg-3)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = find(e.from);
          const b = find(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x + 70}
              y1={a.y + 22}
              x2={b.x + 70}
              y2={b.y + 22}
              stroke="var(--fg-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
              markerEnd="url(#arr)"
              opacity={0.7}
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.name} transform={`translate(${n.x},${n.y})`}>
            <rect
              width={140}
              height={44}
              rx={6}
              fill="var(--bg-elev)"
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={70}
              y={27}
              fontSize={11}
              fontFamily="ui-monospace,monospace"
              textAnchor="middle"
              fill="var(--fg-2)"
            >
              {n.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
