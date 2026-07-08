import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_PROVISIONER_URL: z.string().min(1).optional(),

    // Where the drizzle migrations live at runtime. The server bundles to
    // apps/server/dist, so migrate.ts's `./migrations` sibling lookup doesn't
    // resolve in the image; the Dockerfile sets this to the copied-in folder.
    // Unset in dev, where the sibling path resolves from source.
    DB_MIGRATIONS_DIR: z.string().min(1).optional(),

    REDIS_URL: z.string().min(1),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),

    CORS_ORIGIN: z
      .string()
      .transform((data) => data.split(",").map((s) => s.trim()))
      .pipe(z.array(z.url())),

    // Optional: this is a self-hosted install. Email can be left unconfigured
    // (the server boots fine) or configured at runtime in Settings → Email
    // (Resend or SMTP). When unset AND no platform_settings transport is saved,
    // sendEmail() fails with a clear "email isn't configured" error rather than
    // a cryptic Resend 502 from a placeholder key.
    RESEND_API_KEY: z.string().min(1).optional(),
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

    // Dev-only local wildcard base domain (e.g. `otterdeploy.localhost`).
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
    // Port the main HTTP server (Bun's default export) binds. Bun reads PORT
    // itself; mirrored here so the server can detect when CONTROL_PLANE_PORT
    // equals it (docker-compose passes both as 3000) and skip binding a second,
    // colliding listener on the same port.
    PORT: z.coerce.number().int().positive().default(3000),
    // Public URL of the web app — used to redirect unauthenticated
    // visitors of a protected deployment to the login page. The auth
    // *authority* (master session + getSession) is BETTER_AUTH_URL.
    PUBLIC_WEB_URL: z.url().optional(),

    // Public URL of the API/control plane as reachable from the *public
    // internet* — used only where a third party must call back in (the
    // GitHub App manifest's webhook + callback URLs). In production this is
    // the same host as BETTER_AUTH_URL and can be left unset (the git flow
    // falls back to BETTER_AUTH_URL). In dev, BETTER_AUTH_URL is a private
    // `.localhost` address GitHub can't reach, so point this at your tunnel
    // (e.g. a Tailscale Funnel URL) to register a working App. Does NOT touch
    // auth, CORS, or cookies — those stay anchored to BETTER_AUTH_URL.
    PUBLIC_API_URL: z.url().optional(),

    // Edge logs (packages/api/src/edge-logs). EDGE_LOG_SINK is the host:port
    // Caddy streams JSON to via `output net` (dev: host.docker.internal:9100;
    // Swarm: server service DNS) — BOTH the per-site access logs and, via the
    // global default logger, the operational events (cert/ACME, upstream
    // errors — Phase 3). EDGE_LOG_PORT is the port the server's TCP sink binds.
    // Both unset ⇒ edge logging off (the Edge Logs page shows an empty tail).
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
    // Absolute path to an IP→country .mmdb file (MaxMind DB format). When set,
    // the edge-log sink opens it directly and skips the managed download. Unset
    // ⇒ the sink downloads a free, no-key DB to <DATA_ROOT>/geoip and uses that.
    // See edge-logs/geo.ts.
    EDGE_LOG_GEOIP_DB: z.string().min(1).optional(),
    // Source URL for the auto-downloaded country DB when EDGE_LOG_GEOIP_DB is
    // unset. Defaults to the public-domain DB-IP country-lite MMDB (no license
    // key, monthly-updated) served from jsDelivr. Override for a mirror or an
    // air-gapped install; set EDGE_LOG_GEOIP_DB instead to supply your own file.
    EDGE_LOG_GEOIP_URL: z
      .url()
      .default("https://cdn.jsdelivr.net/npm/@ip-location-db/dbip-country-mmdb/dbip-country.mmdb"),

    // PR previews: hours of inactivity before the hourly cleanup cron tears an
    // open preview down (a keep-alive pin sets autoTeardownAt NULL to exempt
    // it). 0 disables idle teardown entirely. Default 72h.
    PREVIEW_IDLE_TEARDOWN_HOURS: z.coerce.number().int().min(0).default(72),

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
    BUILDER_HELPER_IMAGE: z.string().min(1).default("otterdeploy-builder:latest"),
    BUILDER_HELPER_NETWORK: z.string().min(1).default("otterdeploy_default"),

    // Basic-auth creds for the Workbench BullMQ dashboard (/jobs on the
    // server). Both must be set for the dashboard to mount — it can
    // retry/remove jobs, so it never runs unauthenticated.
    WORKBENCH_USER: z.string().min(1).optional(),
    WORKBENCH_PASS: z.string().min(1).optional(),

    // Social sign-in (SSO). All optional — a provider is only registered when
    // BOTH its client id + secret are set, so leaving these unset is a clean
    // no-op. Distinct from the GitHub *App* used for git providers (that's
    // configured in the UI, not env). The web mirrors which are enabled via
    // VITE_AUTH_SOCIAL_PROVIDERS so it only renders configured buttons.
    GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    GITLAB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    GITLAB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
    // Self-hosted GitLab instance URL (default gitlab.com).
    GITLAB_OAUTH_ISSUER: z.url().optional(),

    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Container runtime backend. `docker` (default) runs each service/database
    // as a plain container on a per-project bridge network — single node, no
    // Swarm required. `swarm` is opt-in for scaling across nodes (replicas,
    // overlay networking). See docs/designs/runtime.md.
    DEPLOY_RUNTIME: z.enum(["docker", "swarm"]).default("docker"),

    // ─── Platform self-updater (packages/api/src/routers/system) ────────────
    // The image tag the compose stack booted with — written into .env by the
    // installer and passed through `env_file`. This is the CURRENT version the
    // updater reports and compares against the latest release. "dev" in a
    // source checkout (never a real release ⇒ nothing to update to).
    OTTERDEPLOY_VERSION: z.string().min(1).default("dev"),
    // Image registry the prod compose pulls from (same default as the compose
    // file). Surfaced so the updater can show/compose the image refs.
    OTTERDEPLOY_REGISTRY: z.string().min(1).default("ghcr.io/otterdeploy"),
    // Where the installer put the compose file + .env on the HOST. The update
    // helper container bind-mounts this (same path in+out) to bump the version
    // and run `docker compose pull && up -d`. The installer writes the real value
    // into .env (it derives from OTTERDEPLOY_DATA_DIR), so this default only
    // applies to source checkouts — it mirrors install.sh's `$DATA_DIR/source`.
    OTTERDEPLOY_INSTALL_DIR: z.string().min(1).default("/data/otterdeploy/source"),
    // GitHub repo (owner/name) whose `releases/latest` is the version source.
    OTTERDEPLOY_UPDATE_REPO: z.string().min(1).default("otterdeploy/otterdeploy"),
    // Override the release manifest URL — point at a fixture/mirror for testing
    // or an air-gapped install. Unset ⇒ derived from OTTERDEPLOY_UPDATE_REPO.
    OTTERDEPLOY_UPDATE_MANIFEST_URL: z.url().optional(),
    // Image the detached update helper container runs (needs docker CLI + the
    // compose plugin). Override if `docker:28-cli` isn't available to you.
    OTTERDEPLOY_UPDATE_HELPER_IMAGE: z.string().min(1).default("docker:28-cli"),
    // Force dry-run apply (simulate the whole update, touch no containers).
    // Unset ⇒ defaults to ON in dev / OFF in production (resolved in the API).
    OTTERDEPLOY_UPDATE_DRY_RUN: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === "true" || v === "1")
      .optional(),
    // Testing hook: make `checkForUpdate` report this as the latest version so
    // the whole "update available" UI lights up with no real newer release.
    OTTERDEPLOY_LATEST_VERSION_OVERRIDE: z.string().min(1).optional(),
  },
  // oxlint-disable-next-line node/no-process-env -- this IS the env boundary; the single sanctioned read of process.env
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
