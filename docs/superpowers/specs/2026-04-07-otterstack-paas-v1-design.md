# Otterstack PaaS v1 — Design Spec

**Date:** 2026-04-07
**Status:** Draft
**Goal:** Build a full PaaS platform — deploy code, provision databases, wire services, observe everything. The next Railway, self-hosted.

---

## 1. Resource Model

### Two top-level types

**Services** — Stateless, built from code.
- Source: GitHub repo (Dockerfile or Nixpacks auto-detect) or Docker image reference
- Lifecycle: build → deploy → running. Redeployable, rollbackable.
- Exposed via project domain (subdomain, path, or internal-only — user chooses per service)
- Config: env vars, build command, start command, port, health check endpoint

**Resources** — Stateful, provisioned by the platform.
- V1 category: Databases (Postgres, MySQL, Redis, MongoDB)
- Lifecycle: provision → running. Persistent volumes attached automatically.
- Expose connection strings and credentials as template variables
- Operations: start, stop, restart

### Compose Stacks

A deploy method, not a third type.

- Supported keys v1: `image`, `build`, `ports`, `volumes`, `environment`, `depends_on`, `healthcheck`, `networks`, `restart`
- Unsupported keys warn, don't fail silently

### Templates

Blueprints that stamp out Services + Resources.
- Config file format (YAML preferred, JSON accepted) defining services, resources, variables, wiring
- Stored in repos (version-controlled) or platform DB (UI-created)
- UI composer can generate and consume template files
- Variable syntax: `${{ServiceName.VAR_NAME}}`, `${{secret(64)}}` for generated values
- Platform ships curated starter templates, community marketplace deferred to v2

### Wiring

Template variables with explicit linking.
- User explicitly links Service → Resource (e.g., "this app uses this Postgres")
- Linked resources inject variables automatically (e.g., `DATABASE_URL`)
- Variables are visible and overridable in the UI
- Cross-service references via `${{ServiceName.VAR_NAME}}`

---

## 2. Architecture

### Monolith with clean module boundaries

Single Hono server process with six internal modules that communicate through defined interfaces. Designed for extraction into separate services when needed. Inngest handles all async work (builds, provisioning, reconciliation).

### Orchestration: Docker Swarm from day one

- Single-node Swarm (`docker swarm init`) — scales to multi-node via `docker swarm join` later
- All services and resources run as Swarm services
- Swarm provides: rolling updates, health checks, restart policies, DNS service discovery, rollback
- Local Docker registry as a Swarm service for storing built images
- Overlay network for inter-service communication

---

## 3. Build & Deploy Pipeline

### Git Integration (GitHub App)

- User installs otterstack GitHub App on their org/repos
- Push webhooks trigger builds automatically
- Build status reported back as GitHub checks (pending/success/failure)
- Architected with a Git provider interface so GitLab/Bitbucket adapters slot in later

### Build Flow

1. Webhook received → Inngest job created
2. Clone repo at commit SHA
3. Detect build method: `Dockerfile` present → Docker build. No Dockerfile → Nixpacks auto-detect
4. Build image, tag with `registry:5000/project-service:commit-sha`
5. Push to local registry
6. Store build record (logs, status, image ref)

### Deploy Flow

1. Build succeeds → `docker service create` (first deploy) or `docker service update --image` (redeploy)
2. Swarm handles rolling update, health checks, container placement
3. On healthy → update Caddy routes via reconciliation
4. On failure → Swarm auto-rolls back, deployment marked failed

### Rollback

- `docker service rollback` — Swarm handles it natively
- UI shows deployment history, one-click rollback to any previous successful deployment
- No rebuild needed, instant

### Compose Deploy

- Parse `docker-compose.yml`, deploy via `docker stack deploy`
- Swarm natively understands Compose files — minimal custom parsing needed
- Each container visible as Service/Resource on the canvas

---

## 4. Routing & Domains

### Project Domains

- Each project gets a default domain: `<project-slug>.otterstack.dev`
- Users can add a custom domain per project
- SSL/TLS handled automatically by Caddy (Let's Encrypt for custom domains, internal certs for platform domains)

### Service Routing (user chooses per service)

- **Subdomain**: `api.myapp.otterstack.dev` or `api.customdomain.com`
- **Path**: `myapp.otterstack.dev/api`
- **Internal-only**: Not exposed publicly, reachable via Swarm overlay network DNS

### Database Routing

- Layer4/SNI pattern for Postgres/MySQL (TCP passthrough via Caddy) — already built
- Redis/MongoDB get similar Layer4 routes with appropriate protocol matchers
- Internal access via Swarm DNS (no proxy needed between linked services)

### Custom Domains

- User adds CNAME pointing their domain to otterstack
- Platform detects the domain, provisions cert via Let's Encrypt, activates routing
- UI shows DNS verification status

---

## 5. Observability

### Log Streaming

- Attach to container stdout/stderr via Docker API
- Stream to frontend via WebSocket (existing WS infrastructure)
- Buffer recent logs in-memory for instant load when UI opens
- Persist logs to disk with rotation (configurable retention per project)
- Filter by service/resource, search within logs

### Metrics

- Docker stats API: CPU, memory, network, disk I/O per container
- Poll on interval, store time-series data in platform Postgres
- Display as graphs on the canvas per service/resource
- Swarm service metrics aggregate across replicas if scaled

### Health Checks

- HTTP services: configurable endpoint (default `/health`), interval, timeout, retries
- Databases: connection test (pg_isready, redis-cli ping, etc.)
- Swarm enforces health checks natively — unhealthy containers get replaced automatically
- UI shows health status on each canvas node (green/yellow/red)
- Health history timeline per service

### Build Logs

- Stored per deployment as part of the build record
- Streamed in real-time during builds via WebSocket
- Viewable in deployment history

---

## 6. Teams & Secrets

### Teams/Orgs

- Better Auth organization plugin generates org/member/invitation tables via CLI
- Organization → has projects, has members
- Roles: owner, admin, member, viewer
- Invite by email, accept/decline flow
- Project-level permissions (who can deploy, who can view)

### Secrets Management

- Two tiers of environment variables per service:
  - **Config vars** — visible in UI, stored in DB (e.g., `NODE_ENV=production`)
  - **Secrets** — encrypted at rest, masked in UI and logs (e.g., `STRIPE_SECRET_KEY`)
- Scoped per environment (dev/staging/prod) when environments are fully implemented
- Template variables (`${{ServiceName.VAR}}`) work across both types
- Secrets never appear in build logs — redacted automatically

---

## 7. Data Model

### Auth tables (Better Auth managed)

Generated by Better Auth CLI with organization plugin. Not defined manually.
- `user`, `session`, `account`, `verification`
- `organization`, `member`, `invitation`

### Custom schema

`project` — **modify existing**
- Add `orgId (FK → organization)`

`resource` — **modify existing**
- Add `swarmServiceId`
- Extend `type` enum: `postgres | mysql | redis | mongodb`

`database_resource` — **keep as-is**
- Engine field already supports multiple database types

`proxy_route` — **modify existing**
- Add `routeMode (subdomain | path)`
- Add `pathPrefix`

`service` — **new**
- id, projectId, name, slug
- sourceType (github | docker_image | compose)
- repoUrl, branch, dockerfilePath (nullable)
- buildMethod (dockerfile | nixpacks | image)
- routeMode (subdomain | path | internal)
- routeValue (the subdomain or path prefix)
- healthCheckPath, healthCheckInterval
- swarmServiceId
- status (draft | building | deploying | running | failed | stopped)

`deployment` — **new**
- id, serviceId
- imageTag, commitSha, commitMessage
- trigger (webhook | manual | rollback)
- configSnapshot (JSON — env vars at deploy time)
- buildLogs (text or reference)
- status (building | deploying | active | failed | rolled_back)

`service_link` — **new**
- id, serviceId, resourceId
- injectedVars (JSON — which template vars get injected)

`env_var` — **new**
- id, serviceId (nullable), resourceId (nullable)
- key, value, isSecret (boolean)
- environment (dev | staging | production)

`github_app_installation` — **new**
- id, orgId
- installationId (GitHub's ID), accountName

`template` — **new**
- id, name, slug, description
- definition (JSON — services, resources, variables, wiring)
- authorId (nullable)
- isOfficial (boolean)

---

## 8. Module Boundaries

Six internal modules in the monolith, each with a clean interface:

### Build Engine (`packages/api/src/build/`)
- Clone repo, detect Dockerfile vs Nixpacks, build image, push to local registry
- Triggered via Inngest jobs
- Interface: `triggerBuild(serviceId, commitSha) → buildId`
- Emits events: `build.started`, `build.succeeded`, `build.failed`

### Container Manager (`packages/api/src/swarm/`)
- Wraps Docker/Swarm API — create service, update, rollback, remove
- Manages volumes, networks, resource provisioning
- Interface: `createService()`, `updateService()`, `rollback()`, `removeService()`, `getStats()`
- Replaces current raw Docker provisioning

### Proxy Controller (`packages/api/src/caddy/`) — already partially built
- Reconciles DB → Caddyfile for HTTP routes, Layer4, custom domains, SSL
- Extends to handle subdomain/path routing modes
- Interface: `reconcile()`, `addDomain()`, `verifyDomain()`

### Log Collector (`packages/api/src/logs/`)
- Attaches to container stdout/stderr, buffers, streams via WebSocket
- Polls Docker stats for metrics
- Interface: `streamLogs(serviceId) → ReadableStream`, `getMetrics(serviceId)`

### Git Integrator (`packages/api/src/git/`)
- GitHub App webhook handler, repo cloning, status reporting
- Provider interface for future GitLab/Bitbucket adapters
- Interface: `handleWebhook(payload)`, `cloneRepo(url, sha)`, `reportStatus(commitSha, status)`

### Template Engine (`packages/api/src/templates/`)
- Parse template YAML/JSON, resolve `${{variables}}`, stamp out services + resources
- Parse Compose files for `docker stack deploy`
- Interface: `deployTemplate(templateId, projectId, vars)`, `parseCompose(file)`

---

## 9. V1 Scope

### In scope
- Services: Deploy from GitHub repo (Dockerfile + Nixpacks) or Docker image
- Resources: Postgres, MySQL, Redis, MongoDB via Swarm
- Routing: Project domains, subdomain/path/internal per service, custom domains + auto-SSL
- Wiring: Template variables with explicit linking
- Observability: Log streaming, container metrics, health checks
- Deploys: Auto-deploy on push, rollback, deployment history
- Compose: Deploy via `docker stack deploy`
- Secrets: Config vars + encrypted secrets, masked in logs
- Teams: Better Auth organization plugin, roles, project-level access
- Templates: YAML/JSON config format, curated starter set
- Canvas UI: Services + resources as nodes, wiring visualized, status indicators

### Deferred to v2+
- Billing/monetization
- Community template marketplace
- GitLab/Bitbucket adapters
- Multi-node Swarm (architecture supports it, not tested/documented)
- Backup/restore for databases
- CI/CD pipeline integrations
- Auto-scaling
- Custom buildpacks

### Build order
1. Migrate existing Postgres provisioning to Swarm
2. Container Manager + Build Engine (deploy a service from GitHub)
3. Proxy Controller extensions (subdomain/path routing, custom domains)
4. Log Collector + metrics
5. Git Integrator (GitHub App, webhooks, auto-deploy)
6. Template Engine + Compose support
7. Teams/orgs + secrets
8. Canvas UI updates for all new resource types
