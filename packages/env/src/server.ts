import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_PROVISIONER_URL: z.string().min(1).optional(),

    REDIS_URL: z.string().min(1),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),

    CORS_ORIGIN: z
      .string()
      .transform((data) => data.split(",").map((s) => s.trim()))
      .pipe(z.array(z.url())),

    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email().default("onboarding@resend.dev"),

    // Notification channels (packages/jobs notification.send). All optional —
    // every notification persists an in-app row regardless; these only enable
    // the external push/sms fan-out. Twilio for SMS, FCM HTTP v1 for push.
    // Unset ⇒ that channel is a logged no-op (in-app row still written).
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),
    FCM_SERVER_KEY: z.string().min(1).optional(),

    CADDY_ADMIN_URL: z.url().default("http://127.0.0.1:2019"),
    CADDY_ADMIN_BIND: z.string().min(1).default("0.0.0.0:2019"),

    // Public IP the swarm manager exposes — embedded in sslip.io fallback
    // domains (`<ip>.sslip.io`) so a fresh install resolves without the
    // operator owning a domain. Persisted to platform_settings.server_ip on
    // first boot: set here = operator override (used verbatim, never
    // overwritten); unset = auto-detected from a public-IP echo service in
    // production. Detection is skipped in development (a dev box's WAN IP
    // isn't reachable on :443 anyway), so set this if you need it locally.
    SERVER_IP: z.string().min(1).optional(),

    // Dev-only local wildcard base domain (e.g. `otterstack.localhost`).
    // When set AND NODE_ENV=development, exposed services resolve to
    // `<resource>-<project>.<LOCAL_BASE_DOMAIN>` — which resolves to loopback
    // and hits the Caddy edge on :443 — instead of the `127.0.0.1.sslip.io`
    // form. Ignored in production (real installs issue ACME certs off
    // org/project domains, so the local wildcard must never leak in).
    LOCAL_BASE_DOMAIN: z.string().min(1).optional(),

    // Deployment protection (docs/designs/deployment-protection.md).
    // host:port Caddy proxies forward_auth + the reserved-path auth
    // handoff to (the control plane). Dev: Caddy runs in a container and
    // reaches the host-run server via host.docker.internal. Swarm: the
    // real server service DNS.
    DEPLOY_AUTHZ_UPSTREAM: z.string().min(1).default("host.docker.internal:3000"),
    // Dev-only: bind a deterministic extra HTTP port for the control plane
    // so Caddy (in a container) can reach forward_auth/callback/share at a
    // stable address — portless assigns the main server's port dynamically.
    // Set this to the PORT in DEPLOY_AUTHZ_UPSTREAM (e.g. 3000). Unset in
    // production (the Swarm service has stable DNS).
    CONTROL_PLANE_PORT: z.coerce.number().int().positive().optional(),
    // Public URL of the web app — used to redirect unauthenticated
    // visitors of a protected deployment to the login page. The auth
    // *authority* (master session + getSession) is BETTER_AUTH_URL.
    PUBLIC_WEB_URL: z.url().optional(),

    // Edge access logs (packages/api/src/edge-logs). EDGE_LOG_SINK is the
    // host:port Caddy streams JSON access logs to via `output net` (dev:
    // host.docker.internal:9100; Swarm: server service DNS). EDGE_LOG_PORT
    // is the port the server's TCP sink binds. Both unset ⇒ access logging
    // off (the Edge Logs page shows an empty live tail).
    EDGE_LOG_SINK: z.string().min(1).optional(),
    EDGE_LOG_PORT: z.coerce.number().int().positive().default(9100),
    // Persist access logs to the edge_log table behind the live ring
    // (Phase 2 — enables 24h/7d ranges + percentiles across restarts).
    // Default on whenever the sink is configured; set to false for a
    // pure in-memory tail.
    EDGE_LOG_PERSIST: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === "true" || v === "1")
      .default(true),

    // CrowdSec IP-reputation bouncer (deployment-protection.md §10). When
    // both are set, the Caddyfile gains the global `crowdsec` app + a
    // per-site `crowdsec` gate, and the Firewall page reads decisions from
    // LAPI. The agent ships bundled (docker-compose `crowdsec` service, the
    // `firewall` profile) and auto-registers the Caddy bouncer with this key;
    // the plugin is already compiled into infra/caddy/Dockerfile. So enabling
    // is just: set these two + start the profile — no manual agent, no rebuild.
    // LAPI_URL is the agent's service DNS on the compose network
    // (http://crowdsec:8080).
    CROWDSEC_LAPI_URL: z.url().optional(),
    CROWDSEC_BOUNCER_KEY: z.string().min(1).optional(),

    // GitHub Apps are created through the manifest flow (UI button in
    // Settings → Git Providers). App ID, client secret, webhook secret,
    // PEM private key, and slug all live on the `git_provider` row
    // (secrets encrypted at rest via packages/api/src/lib/crypto.ts) —
    // no env vars for any of it. Matches how Coolify and Dokploy
    // configure GitHub Apps.

    // Build pipeline — apps/builder. Concurrency is how many deploy
    // jobs the builder pulls from the queue at once; default 1 keeps
    // docker builds from contending on the daemon.
    BUILDER_CONCURRENCY: z.coerce.number().int().positive().default(1),

    // Per-build isolation: each deployment runs in a throwaway "helper"
    // container (Coolify-style) the worker spawns via `docker run --rm`.
    // IMAGE is what it runs (the builder image itself, which carries the
    // railpack/docker toolchain + this code); NETWORK is the docker network
    // it joins so it can reach Postgres/Redis. Defaults match docker-compose.
    BUILDER_HELPER_IMAGE: z.string().min(1).default("otterstack-builder:latest"),
    BUILDER_HELPER_NETWORK: z.string().min(1).default("otterstack_default"),

    // Basic-auth creds for the Workbench BullMQ dashboard (/jobs on the
    // server). Both must be set for the dashboard to mount — it can
    // retry/remove jobs, so it never runs unauthenticated.
    WORKBENCH_USER: z.string().min(1).optional(),
    WORKBENCH_PASS: z.string().min(1).optional(),

    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
