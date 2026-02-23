# OtterStack Infrastructure Implementation Design

**Date:** 2026-02-23
**Status:** Conditionally Approved (production rollout gated by Section 16 P0)
**Scope:** Full deploy pipeline + monitoring + backups

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment model | Self-hosted, same-server (like Coolify) | OtterStack runs on the server it deploys to |
| Container orchestration | Docker Swarm single-node (like Dokploy) | Free rolling updates, health checks, restart policies, with an explicit multi-node migration path (Section 11.9) |
| Reverse proxy | Caddy via Admin API | Automatic HTTPS, instant config updates, `--resume` for restart recovery |
| Primary builder | Nixpacks | Zero-config, covers 90% of apps |
| Git integration | GitHub App + webhooks | Auto-deploy on push, PR events |
| Database services | PostgreSQL, Redis, MySQL, MongoDB | Covers the major four |
| Deploy strategy | Blue-green via Swarm `start-first` | Zero-downtime: start new before stopping old |
| MVP scope | Full pipeline + monitoring + backups | Code to live URL, plus operational visibility and data protection |

---

## Architecture Overview

```
User pushes code to GitHub
        |
        v
GitHub webhook --> OtterStack Server (Hono)
        |
        v
Inngest event: deployment.requested
        |
        v
Worker pipeline (Inngest steps):
  1. Validate resource & environment
  2. Clone repo (GitHub App token)
  3. Snapshot env vars
  4. Build image (Nixpacks / Dockerfile / pull)
  5. Run pre-deploy command (optional)
  6. Create/update Swarm service (start-first)
  7. Health check polling
  8. Push Caddy route config
  9. Verify traffic flowing
  10. Cleanup old images
        |
        v
Caddy routes traffic --> Docker container
        |
        v
User's app is live at custom domain with automatic SSL
```

---

## Section 1: Core Docker Infrastructure Layer

**Package:** `packages/docker/`

Foundation layer. Everything else depends on this.

### 1.1 Docker Client Wrapper

Dockerode instance connected to `/var/run/docker.sock`. Single shared instance across the application. Exports typed helper functions rather than exposing Dockerode directly.

### 1.2 Swarm Initialization

On first server setup:
- `docker.swarmInit({ ListenAddr: "127.0.0.1:2377" })` — bind Swarm manager to localhost only, never internet-exposed
- Create project-scoped overlay networks for tenant isolation (see 1.5)
- Verify Swarm is active on subsequent startups, re-init if needed

### 1.3 Service CRUD

All application containers are Swarm services, not raw containers.

| Function | Description |
|----------|-------------|
| `createService(opts)` | Create a new Swarm service with image, env, ports, volumes, health check, restart policy, resource limits |
| `updateService(name, opts)` | Update existing service (triggers rolling update with `start-first`) |
| `removeService(name)` | Remove service and its tasks |
| `inspectService(name)` | Get current service spec and status |
| `listServices(filters)` | List services by label filters (e.g., all services for a project) |
| `getServiceLogs(name, opts)` | Stream stdout/stderr from service tasks |
| `scaleService(name, replicas)` | Scale to N replicas (scale to 0 = stop) |

Service naming convention: `otterstack-{resourceId}` with labels:
- `otterstack.resource.id={resourceId}`
- `otterstack.project.id={projectId}`
- `otterstack.environment.id={environmentId}`
- `otterstack.organization.id={organizationId}`

### 1.4 Image Management

| Function | Description |
|----------|-------------|
| `pullImage(image, tag)` | Pull from registry |
| `tagImage(source, target)` | Tag for rollback: `appName:latest` + `appName:v{N}` |
| `removeImage(name, tag)` | Remove specific image tag |
| `pruneImages()` | Remove dangling/unused images |
| `listImages(filters)` | List images by label or name prefix |

### 1.5 Network Management

**Tenant isolation model:** No shared flat network. Each project gets its own overlay network:
- Network per project: `otterstack-proj-{projectId}` (overlay, encrypted)
- All resources in a project share their project network (enables DNS service discovery between linked services)
- Cross-project communication is blocked by default (separate overlay networks)
- A shared `otterstack-ingress` network connects Caddy to all project networks for routing

| Function | Description |
|----------|-------------|
| `createProjectNetwork(projectId)` | Create project-scoped overlay network with encryption. **Also connects Caddy service to the new network** for DNS resolution. |
| `removeProjectNetwork(projectId)` | Remove project network (after all services removed). Disconnect Caddy first. |
| `connectService(service, network)` | Attach service to project network + ingress network |
| `disconnectService(service, network)` | Remove service from network |

### 1.6 Volume Management

| Function | Description |
|----------|-------------|
| `createVolume(name, labels)` | Create named volume |
| `removeVolume(name)` | Remove volume (with safety check: not in use) |
| `inspectVolume(name)` | Get volume details and usage |
| `listVolumes(filters)` | List volumes by label |

Volume naming convention: `otterstack-{resourceId}-data`

### 1.6b File & Bind Mount Support

Beyond named volumes, containers often need individual config files injected:

- **Docker configs** (Swarm-native): create configs via `docker.createConfig()`, mount into containers as files. Ideal for `nginx.conf`, `prometheus.yml`, application config files.
- **File mounts**: store file content in a `configFile` table (name, content, resourceId), create as Docker configs at deploy time, mount at specified container path.
- **Bind mounts**: mount host directories into containers (e.g., `/var/run/docker.sock` for tools that need Docker access). Restricted to admin-created resources only (security risk).

| Function | Description |
|----------|-------------|
| `createConfig(name, data, labels)` | Create a Docker config from file content |
| `updateConfig(name, data)` | Remove old + create new (configs are immutable in Swarm) |
| `removeConfig(name)` | Remove config |
| `listConfigs(filters)` | List configs by label |

### 1.7 Container Queries & Stats

| Function | Description |
|----------|-------------|
| `listContainers(serviceFilter)` | List running containers for a Swarm service |
| `getContainerStats(containerId)` | CPU %, memory usage, network I/O, disk I/O |
| `execInContainer(containerId, cmd)` | Execute command inside running container (for db dumps, health checks) |

### 1.8 Docker Cleanup (Threshold-Based)

Inngest cron function running every 6 hours with threshold-based triggers:

**Light cleanup** (always runs):
- Prune dangling images
- Prune stopped containers not managed by Swarm
- Log cleanup actions to audit log

**Aggressive cleanup** (only when disk usage exceeds configurable threshold, default 80%):
- Prune unused images (not just dangling)
- Prune unused volumes (with opt-in flag)
- Prune build cache
- Report space reclaimed (before/after disk usage)

**Disk usage monitoring** (integrated with Section 9):
- Check host disk usage at `/var/lib/docker` as part of stats collection
- Emit `server.disk.warning` event when usage exceeds warning threshold (default 75%)
- Emit `server.disk.critical` event when usage exceeds critical threshold (default 90%)
- Trigger notification to configured channels
- Builds will fail on a full disk — proactive alerts prevent this

---

## Section 2: Build System

**Package:** `packages/builder/`

Converts user source code into Docker images.

### 2.1 Build Dispatcher

Factory function that routes to the correct builder based on `buildMethod` field on the resource:

```
nixpacks     --> NixpacksBuilder
dockerfile   --> DockerfileBuilder
docker_image --> DockerImageBuilder (pull only, no build)
static       --> StaticBuilder (Caddy file server)
compose      --> ComposeBuilder (multi-container stack)
```

Common interface:
- Input: source directory path, resource config, env vars, build args
- Output: image name + tag, build duration, build logs

### 2.2 Nixpacks Adapter

- Shell out to `nixpacks build <dir> --name <appName> --env VAR=value`
- Produces Docker image tagged `<appName>:latest`
- Stream build stdout/stderr to deployment event logs
- Support `buildCommand` override in resource config
- Support `startCommand` override (injected into Procfile/nixpacks plan)

### 2.3 Dockerfile Adapter

- `docker build -f <dockerfilePath> -t <appName>:<tag> <context>`
- Support build args from env vars marked `isBuildTime`
- Support multi-stage builds (no special handling needed)
- Support custom context directory

### 2.4 Docker Image Adapter

- `docker pull <registry>/<image>:<tag>`
- No build step — just pull a pre-built image from any registry
- Support private registries with auth credentials (see 2.4b)

### 2.4b Container Registry Management

CRUD for Docker registry credentials. Required for pulling private images and for future multi-node image distribution.

- **Registry CRUD**: add/update/remove registry credentials per organization
- **Supported registries**: Docker Hub, GitHub Container Registry (GHCR), AWS ECR, Google Artifact Registry, GitLab Container Registry, any self-hosted registry
- **Auth flow**: `docker login` equivalent via Dockerode — store auth config in Swarm secrets
- **Per-resource registry selection**: each resource can specify which registry to pull from
- **Schema**: new `containerRegistry` table (id, organizationId, name, url, username, passwordSecretRef, createdAt, updatedAt)
- **Optional image push**: after building locally, optionally push to a registry (needed for multi-node in Section 11.9)

### 2.5 Static Site Adapter

- Generate a minimal Caddy Dockerfile:
  ```dockerfile
  FROM caddy:2-alpine
  COPY . /srv
  COPY Caddyfile /etc/caddy/Caddyfile
  ```
- Generated Caddyfile enables `file_server` with `root * /srv`
- Build with `docker build`
- Configurable: SPA mode (`try_files {path} /index.html`) vs static mode
- Reuses the same Caddy image already in the stack — no extra image to pull

### 2.6 Docker Compose / Stack Support

Deploy multi-container applications from a `docker-compose.yml`:

- Accept compose file from git repo or inline (pasted in UI)
- Parse and validate compose spec using `@docker/compose` or custom parser
- Deploy via `docker stack deploy --compose-file <file> --with-registry-auth <stackName>` (Swarm-native stack deployment)
- Stack naming: `otterstack-{resourceId}` to avoid collisions
- Handle compose-specific features:
  - `depends_on`: service start ordering
  - Shared networks: translate to project overlay network
  - Volume mounts: create named volumes with OtterStack naming convention
  - Environment variables: inject from OtterStack env var system (Section 7)
  - Port mappings: register with Caddy for routing
- **Compose resource type**: a resource with `kind: compose` represents an entire stack. Individual services within the stack are not modeled as separate OtterStack resources — the compose file is the source of truth.
- **Updates**: re-deploy with `docker stack deploy` (idempotent, Swarm handles rolling updates per service)
- **Teardown**: `docker stack rm <stackName>`
- **Logs**: aggregate logs from all services in the stack

This covers the common case of deploying pre-packaged apps (WordPress, Plausible, Ghost, n8n, Gitea, etc.) that ship as compose files.

### 2.7 Build Context Preparation

- Clone repo to temp directory (from git module)
- Apply `rootDirectory` filter (cd into subdirectory for monorepos)
- Inject default `.dockerignore` if not present (exclude `.git`, `node_modules`)
- Clean up temp directory after build completes or fails

### 2.7 Build Log Streaming

- Capture stdout/stderr from build process
- Write lines to `deploymentEvent` rows in real-time
- Support websocket streaming to UI (via existing Zero sync or direct SSE)

### 2.8 Image Tagging Strategy

Every successful build produces two tags:
- `otterstack-{resourceId}:latest` — current version
- `otterstack-{resourceId}:v{deploymentNumber}` — immutable rollback target

Retain last 10 versioned tags per resource. Prune older ones during cleanup.

### 2.9 Build Timeout

- Default: 10 minutes
- Configurable per resource in metadata
- Kill build process if exceeded, mark deployment as failed

### 2.10 Force Rebuild

- Deployment trigger accepts a `force: true` flag
- When force is set:
  - Nixpacks: pass `--no-cache` to nixpacks build
  - Dockerfile: pass `--no-cache` to docker build
  - Docker Image: always pull latest even if tag exists locally
  - Static: rebuild from scratch
- Skips the "image already exists" idempotency check in pipeline Step 4
- Exposed in UI as a "Force Rebuild" button on the deploy action
- Exposed in API as `force` parameter on `deployment.create`

### 2.11 Nixpacks Installation

During server setup:
- Check if `nixpacks` binary exists
- If not, install via `curl -sSL https://nixpacks.com/install.sh | bash`
- Verify version meets minimum requirement

---

## Section 3: Git Integration

**Package:** `packages/git/`

Handles source code acquisition from git providers.

### 3.0 Git Provider Abstraction

All git operations go through a `GitProviderAdapter` interface so providers are swappable:

```typescript
interface GitProviderAdapter {
  clone(repo: GitRepository, targetDir: string, opts?: { commitSha?: string; depth?: number }): Promise<Result<string, GitCloneError>>;
  getAccessToken(provider: GitProvider): Promise<Result<string, GitAuthError>>;
  parseWebhook(headers: Headers, body: unknown): Result<WebhookEvent, WebhookParseError>;
  validateWebhookSignature(headers: Headers, body: string, secret: string): boolean;
  listRepositories(provider: GitProvider): Promise<Result<Repository[], GitApiError>>;
}
```

**MVP**: GitHub adapter (P0). **P1**: GitLab, Bitbucket, Gitea adapters. **P0**: Generic Git SSH/HTTPS clone (no webhooks, manual deploy only).

The existing `gitProvider` schema already has a generic `type` field — the adapter is selected based on this value. All Section 3 subsections below describe GitHub-specific behavior but follow the adapter interface so other providers plug in without pipeline changes.

### 3.1 GitHub App Registration Flow

- User registers a GitHub App (or installs OtterStack's shared app)
- OAuth callback stores `appId`, `clientId`, `clientSecret`, `installationId` in `gitProvider` table
- Generate installation access tokens for API calls

### 3.2 GitHub Webhook Receiver

New endpoint: `POST /api/webhooks/github`

- Validate `X-Hub-Signature-256` header using webhook secret (HMAC-SHA256)
- **Replay protection**: extract `X-GitHub-Delivery` header (unique delivery ID)
  - Store delivery IDs in a `webhookDelivery` table (id, receivedAt, TTL 72 hours)
  - Reject duplicate delivery IDs with 200 OK (idempotent — GitHub will stop retrying)
  - Scheduled cleanup job prunes delivery records older than 72 hours
- Parse event type from `X-GitHub-Event` header
- Handle events:
  - `push` — trigger deploy if branch matches configured branch
  - `pull_request` (opened/synchronize) — trigger preview deploy (future)
  - `installation` — handle app install/uninstall

### 3.3 Webhook Event Parser

Extract from push payload:
- Repository owner + name
- Branch ref
- Commit SHA + message
- List of changed file paths (for watch path filtering)
- Pusher identity (for audit: "who triggered this deploy")

### 3.4 Repository Cloner

```
cloneRepository({
  provider: GitProvider,
  repository: GitRepository,
  commitSha?: string,
  targetDir: string,
}) → Result<{ path: string }, GitCloneError>
```

- Private repos: clone via GitHub App installation token as HTTPS auth
- Public repos: clone via HTTPS, no auth
- SSH deploy keys: clone via SSH with key from secret store

### 3.5 Branch & Commit Checkout

- Default: clone configured branch at HEAD
- On webhook: checkout specific commit SHA
- On manual deploy: checkout branch HEAD or user-specified ref

### 3.6 Shallow Clone

- Default: `--depth 1 --single-branch` for speed
- Full clone only when explicitly needed (e.g., git history analysis)

### 3.7 Root Directory Support

After clone, if `rootDirectory` is set on `gitRepository`:
- Verify subdirectory exists
- All build operations use this as their working directory
- Essential for monorepo support

### 3.8 Auto-Deploy Trigger

When webhook received and `autoDeploy` is true on `gitRepository`:
1. Match repo + branch to a `gitRepository` row
2. Check watch paths (if configured)
3. Create a new `deployment` row with `source: "git_push"`
4. Emit `deployment.requested` Inngest event

### 3.9 Watch Paths Filter

- Optional array of glob patterns on `gitRepository.watchPaths` (text array column)
- On push event, compare changed file paths against patterns
- Only trigger deploy if at least one changed file matches
- Critical for monorepos: `apps/api/**` only deploys when API code changes

### 3.10 Git Credential Management

- GitHub App tokens: short-lived, generated per clone operation
- SSH deploy keys: stored as secret references, loaded at clone time
- Webhook secrets: stored as secret references, loaded at validation time

### 3.11 Webhook Secret Validation

- Compute HMAC-SHA256 of raw request body using stored webhook secret
- Compare against `X-Hub-Signature-256` header
- Reject requests with invalid or missing signatures
- Log failed validation attempts to audit log

### 3.12 Preview Deployments (PR Environments)

Auto-deploy per pull request for review/testing before merge:

- **Trigger**: `pull_request` webhook event (opened, synchronize, reopened)
- **Model**: create a temporary `deployment` with `source: "preview"` and a reference to the PR number
- **Domain**: auto-generated subdomain: `pr-{prNumber}-{resourceName}.{baseDomain}` (e.g., `pr-42-api.apps.example.com`)
- **Database handling**: preview deployments share the staging environment's databases by default (no ephemeral DB per PR — too expensive). Configurable: users can opt into isolated preview databases for specific resources.
- **Env vars**: inherit from the staging or preview environment, with `PR_NUMBER` and `PREVIEW_URL` injected automatically
- **Lifecycle**:
  1. PR opened → clone PR branch → build → deploy as separate Swarm service → create Caddy route
  2. PR updated (new commits) → rebuild and redeploy the preview service
  3. PR merged/closed → remove preview Swarm service → remove Caddy route → cleanup image tags
- **PR comment integration** (P1): post a comment on the PR with the preview URL and deploy status
- **Resource naming**: preview services are named `otterstack-{resourceId}-pr-{prNumber}` to avoid collision with production
- **Limits**: configurable max concurrent preview deployments per resource (default: 5). Oldest previews auto-cleaned when limit exceeded.

### 3.13 Generic Git Clone (SSH/HTTPS)

For users without a GitHub App (or using GitLab/Bitbucket/Gitea before adapters are built):

- Clone any git repository via HTTPS URL (public) or SSH deploy key (private)
- No webhooks — manual deploy trigger only
- User provides: git URL, branch, optional SSH key reference
- Uses the same `cloneRepository()` flow as GitHub, just with different auth

---

## Section 4: Deployment Pipeline

**Package:** `apps/worker/` (Inngest functions)

The core orchestration: ties git, build, docker, and proxy together.

### 4.1 Main Pipeline: `deployment.requested`

Inngest step function with 10 sequential steps. Each step is individually retryable and **idempotent**. Failure at any step marks the deployment as failed and preserves the previous running version.

**Idempotency:** Each step uses `deploymentId` as its idempotency key. Retried steps must produce the same result:
- `clone`: check if build dir already exists with correct commit SHA, skip if so
- `build`: check if image tag `otterstack-{resourceId}:v{N}` already exists, skip if so
- `deploy`: Swarm service update is inherently idempotent (same spec = no-op)
- `route`: Caddy route upsert by `@id` is idempotent
- `cleanup`: delete operations are idempotent (deleting non-existent resources is a no-op)

```
Step 1: validate
Step 2: clone
Step 3: resolve-secrets
Step 4: build
Step 5: pre-deploy-command
Step 6: deploy-swarm-service
Step 7: health-check
Step 8: route-traffic
Step 9: verify
Step 10: cleanup
```

### 4.2 Step 1: Validate

- Fetch resource, environment, project from DB
- Verify no other deployment is currently `building` or `deploying` for this resource
- If conflict: queue this deployment (status stays `queued`) and wait
- Transition: `queued` → `building`
- Emit `deploymentEvent`: status=building

### 4.3 Step 2: Clone Source

- If `buildMethod` is `docker_image`: skip (no source code needed)
- Otherwise: call `git.cloneRepository()` with resource's git config
- Clone to `/tmp/otterstack-builds/{deploymentId}/`
- Apply root directory filter
- Log clone duration

### 4.4 Step 3: Resolve Secrets

- Fetch all env vars for this resource (with scope inheritance: project → environment → resource)
- Resolve secret references (fetch from Infisical or native provider)
- Resolve inter-resource references (`${db.connectionString}`)
- Create `deploymentSecretSnapshot` row (already implemented)
- Separate into build-time vars and runtime vars

### 4.5 Step 4: Build Image

- Dispatch to appropriate builder (nixpacks/dockerfile/docker_image/static/compose)
- Pass build-time env vars
- If `force: true` on deployment: pass `--no-cache` flags, skip idempotency check (see Section 2.10)
- Stream build logs to deployment events
- Tag image: `otterstack-{resourceId}:latest` + `otterstack-{resourceId}:v{N}`
- On failure: mark deployment failed, emit event, stop pipeline

**Build server decoupling (future):** This step is intentionally decoupled from Step 6 (deploy). The build produces an image reference; the deploy consumes it. This enables future build-server offloading where builds happen on a separate machine and images are pushed to a registry (Section 2.4b), then pulled on the deploy target.

### 4.6 Step 5: Pre-Deploy Command

- If `preDeployCommand` is set on resource (e.g., `npm run migrate`)
- Run in a temporary container using the newly built image
- Inject runtime env vars
- Connect to `otterstack-proj-{projectId}` (project-scoped network so it can reach linked databases/services)
- Wait for exit code 0, fail deployment on non-zero
- Remove temporary container after completion

### 4.7 Step 6: Deploy Swarm Service (Blue-Green)

- Transition: `building` → `deploying`
- Check if Swarm service `otterstack-{resourceId}` exists:
  - **Exists**: `service.update()` with new image, env vars, config. Set `UpdateConfig.Order: "start-first"` for blue-green.
  - **New**: `docker.createService()` with full spec

Service spec includes:
- Image: newly built tag
- Env vars: runtime vars from secret snapshot
- Ports: resource's configured port
- Volumes: linked volume resources
- Health check: from resource config
- Restart policy: from resource config (`always` / `on-failure` / `no`)
- Resource limits: CPU + memory from resource config
- Labels: OtterStack metadata for discovery
- Networks: `otterstack-proj-{projectId}` (project network) + `otterstack-ingress` (for Caddy routing)

**Explicit UpdateConfig:**
```
UpdateConfig: {
  Parallelism: 1,
  Order: "start-first",
  FailureAction: "rollback",
  Monitor: "30s",
  MaxFailureRatio: 0.0,
}
```

**Explicit RollbackConfig:**
```
RollbackConfig: {
  Parallelism: 1,
  Order: "stop-first",
  FailureAction: "pause",
  Monitor: "15s",
  MaxFailureRatio: 0.0,
}
```

This means: on update failure, Swarm automatically rolls back to the previous version. If rollback itself fails, Swarm pauses for manual intervention.

### 4.8 Step 7: Health Check

- Poll the new container's health endpoint at `healthCheckPath` (if configured)
- Alternatively, check Docker health check status via Swarm task state
- Timeout: 120 seconds (configurable)
- Poll interval: 5 seconds
- On healthy: proceed to routing
- On timeout or unhealthy: Swarm auto-rolls back (per `UpdateConfig.FailureAction: "rollback"`), OtterStack marks deployment as failed

### 4.9 Step 8: Route Traffic

- Call `proxySync.syncResourceProxy()` from `packages/proxy/`
- For each verified domain on this resource:
  - Build `CaddyRoute` pointing at `otterstack-{resourceId}:{port}`
  - Push to Caddy Admin API via `updateRoute()` (uses `@id` for idempotency)
- Caddy auto-provisions SSL for any new domains
- Caddy auto-saves config to `autosave.json`

### 4.10 Step 9: Verify

- Transition: `deploying` → `verifying`
- Confirm new container is running and receiving traffic
- Optional: HTTP probe to the public URL
- Transition: `verifying` → `live`
- Emit `deployment.released` event
- Record `completedAt` and `duration`

### 4.11 Step 10: Cleanup

- Remove build directory `/tmp/otterstack-builds/{deploymentId}/`
- Prune old image tags beyond retention (keep last 10)
- Update `previousImageTag` on deployment record

### 4.12 Failure Handling

- On any step failure: catch error, set deployment status to `failed`
- Emit `deploymentEvent` with failure reason and metadata
- Previous Swarm service version keeps running (no traffic disruption)
- Emit `deployment.failed` event for notifications

### 4.13 Cancellation

- User sends `deployment.cancel` via API
- Worker checks for cancellation flag at each step boundary
- If building: kill build process
- If deploying: force rollback Swarm service to previous spec
- Set status to `canceled`

### 4.14 Rollback Flow

Triggered by `deployment.rollback` event:
1. Look up the target deployment's image tag (`otterstack-{resourceId}:v{N}`)
2. `service.update()` with the old image tag
3. Wait for health check
4. Re-push Caddy config (in case ports/domains changed)
5. Create new deployment record with `source: "rollback"`

### 4.15 Deployment Concurrency & Queue Semantics

- Per-resource mutex: only one deployment can be `building` or `deploying` at a time
- Additional deployments stay `queued`
- Implement via Inngest concurrency controls or DB-level advisory locks

**Queue policy:**
- **Ordering**: FIFO (first-in, first-out) by default
- **Superseded-commit collapse**: if multiple pushes queue up for the same resource, only the latest commit deploys — intermediate queued deployments are auto-canceled with reason `"superseded"`
- **Queue TTL**: queued deployments expire after 1 hour — auto-canceled with reason `"expired"`
- **Cancellation**: users can cancel any queued deployment; canceling the active deployment promotes the next queued one
- **Dequeue**: when active deployment completes or fails, dequeue next (after supersede/TTL filtering)

### 4.16 Deployment Status Events

Every state transition creates a `deploymentEvent` row:
- `queued` → `building` → `deploying` → `verifying` → `live`
- Or: `queued` → `building` → `failed`
- Or: `deploying` → `canceled`
- Each event records: previous status, new status, actor, reason, timestamp, metadata

### 4.17 Deploy Log Aggregation

Unified log for a deployment combining:
- Git clone output
- Build stdout/stderr
- Pre-deploy command output
- Deploy/health check events
- Routing updates

All stored as `deploymentEvent` rows with a `log` category. API returns them ordered by timestamp.

---

## Section 5: Reverse Proxy (Caddy)

**Package:** `packages/proxy/`

Based on the existing Caddy Admin API design doc (`research/caddy-admin-api-design.md`).

### 5.1 Caddy Admin API Client (`caddy-client.ts`)

HTTP client for Caddy's Admin API at `localhost:2019`:

| Function | HTTP | Path |
|----------|------|------|
| `getConfig()` | GET | `/config/` |
| `getConfigPath(path)` | GET | `/config/{path}` |
| `setConfigPath(path, value)` | POST | `/config/{path}` |
| `addRoute(route, serverKey)` | PATCH | `/config/apps/http/servers/{key}/routes` |
| `removeRouteById(routeId)` | DELETE | `/id/{routeId}` |
| `updateRoute(route)` | PATCH | `/id/{routeId}` (atomic single-request update, no delete+add race) |
| `loadConfig(config)` | POST | `/load` (atomic full config replacement) |

**Atomic updates:** `updateRoute()` uses Caddy's `PATCH /id/{routeId}` for atomic in-place updates. This avoids the delete-then-add pattern that can briefly remove routes under concurrent events. For multi-route updates (e.g., full server resync), use `loadConfig()` which is also atomic.

### 5.2 Route Config Builder (`config-builder.ts`)

Build `CaddyRoute` JSON from OtterStack resource + domain data:
- Match: `host: ["example.com"]`
- Handle: reverse_proxy to `otterstack-{resourceId}:{port}`
- Optional: compression, security headers, basic auth, path prefix

Route ID scheme: `route-{resourceId}-{hash6(domain)}` for targeted updates.

### 5.3 Middleware Helpers (`middleware.ts`)

Builder functions for Caddy handler objects:
- `createReverseProxyHandler()` — upstream targets with health checks
- `createCompressionHandler()` — gzip + zstd
- `createSecurityHeadersHandler()` — HSTS, X-Content-Type-Options, X-Frame-Options
- `createBasicAuthHandler()` — HTTP basic auth with bcrypt hashes
- `createStripPrefixHandler()` — path prefix stripping for path-based routing

### 5.4 SSL/TLS

Caddy handles Let's Encrypt ACME automatically:
- Add a domain to a route's `host` matcher → Caddy auto-provisions SSL
- Certificates stored in `/data/caddy/` volume (persists across restarts)
- No OtterStack code needed for standard SSL

Custom certificates:
- Accept PEM cert + key upload
- Push to Caddy TLS config via Admin API
- Store cert metadata in DB

### 5.5 Caddy Container Lifecycle (`container.ts`)

- Bootstrap: create Caddy Swarm service with `caddy:2-alpine` image
- Command: `caddy run --resume`
- Volumes: `otterstack-caddy-data:/data`, `otterstack-caddy-config:/config`
- Public ports: 80, 443, 443/udp (HTTP/3) — bound to `0.0.0.0`
- **Admin API port 2019: bound to `127.0.0.1` only** — never internet-exposed. Caddy config: `admin 127.0.0.1:2019`
- Network: `otterstack-ingress` (connects to all project networks for routing)
- Health check: `GET http://localhost:2019/config/` returns 200

### 5.6 Wildcard Subdomain Routing

Domain configuration at three levels (narrower overrides broader):

1. **Server level**: default base domain for all projects on this server (e.g., `*.apps.example.com`)
2. **Project level**: override base domain for a specific project (e.g., `*.myapp.io`)
3. **Resource level**: override domain for a specific service (e.g., `api.myapp.io`)

Auto-generated URL resolution order:
- If resource has a custom domain → use it
- Else if project has a base domain → `{resourceName}.{projectBaseDomain}`
- Else use server base domain → `{resourceName}-{projectSlug}.{serverBaseDomain}`

Wildcard SSL via Caddy's DNS challenge (requires DNS provider API key) for server and project level domains.

### 5.7 TCP Proxying for Databases

- For externally exposed databases, use Caddy Layer 4 plugin
- Requires custom Caddy build with `caddy-l4` module
- Route TCP traffic on specific ports to database containers
- Optional: defer to simple Docker port mapping instead (simpler)

### 5.8 Inngest Event Handlers

| Handler | Trigger | Action |
|---------|---------|--------|
| `proxy-on-deployment-released` | `deployment.released` | `syncResourceProxy()` — update route upstreams |
| `proxy-on-domain-verified` | `domain.verified` | `syncDomainProxy()` — add route, SSL auto-provisions |
| `proxy-on-resource-deleted` | `resource.deleted` | `removeResourceProxy()` — delete route by `@id` |

### 5.9 Full Server Resync

`syncServerProxy()` — rebuild all Caddy routes from DB state:
1. Fetch all resources assigned to this server
2. Build complete `CaddyConfig` with all routes
3. `loadConfig()` — atomic replacement
4. Use as recovery after Caddy config corruption

### 5.10 Caddy Self-Healing

Automated recovery when Caddy crashes or is accidentally deleted:

- **Health check** (part of Section 9.12 server monitoring): every 60 seconds, verify Caddy Swarm service exists and Admin API responds
- **Auto-restart**: if Caddy service is missing, recreate it from the spec in Section 5.5
- **Network reconnection**: after restart, reconnect Caddy to all project overlay networks (new projects may have been created since Caddy last started). Query all `otterstack-proj-*` networks and connect.
- **Route resync**: after restart, if `--resume` fails to load `autosave.json`, trigger `syncServerProxy()` to rebuild all routes from DB
- **Event emission**: emit `proxy.restarted` or `proxy.failed` event for notification

---

## Section 6: Database Provisioning

**Packages:** `packages/docker/` + `packages/domain/`

Managed database services deployed as Swarm services.

### 6.1 Database Provisioner

Per-type configuration map:

| Database | Image | Data Path | Health Check | Default Port |
|----------|-------|-----------|-------------|-------------|
| PostgreSQL | `postgres:16` | `/var/lib/postgresql/data` | `pg_isready -U $user` | 5432 |
| Redis | `redis:7-alpine` | `/data` | `redis-cli ping` | 6379 |
| MySQL | `mysql:8` | `/var/lib/mysql` | `mysqladmin ping -u root -p$password` | 3306 |
| MongoDB | `mongo:7` | `/data/db` | `mongosh --eval "db.runCommand('ping')"` | 27017 |

### 6.2 Provisioning Flow

When a resource with `kind: database` or `kind: cache` is created:
1. Generate cryptographically random credentials (username, password, database name)
2. Store credentials as secret references
3. Create named volume: `otterstack-{resourceId}-data`
4. Create Swarm service with:
   - Correct image + tag (user-selectable version)
   - Env vars for initial credentials (e.g., `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`)
   - Volume mount at correct data path
   - Health check command
   - Restart policy: `always`
   - Resource limits from user config
5. Wait for health check to pass
6. Store connection info in resource metadata

### 6.3 Connection String Injection

When a service resource links to a database resource (`depends_on` or `network` link type):
- Auto-generate connection string env var in the service:
  - PostgreSQL: `DATABASE_URL=postgresql://{user}:{pass}@otterstack-{dbResourceId}:{port}/{dbname}`
  - Redis: `REDIS_URL=redis://:{pass}@otterstack-{dbResourceId}:{port}`
  - MySQL: `DATABASE_URL=mysql://{user}:{pass}@otterstack-{dbResourceId}:{port}/{dbname}`
  - MongoDB: `MONGODB_URI=mongodb://{user}:{pass}@otterstack-{dbResourceId}:{port}/{dbname}`
- Uses Swarm service name as hostname (DNS resolution within overlay network)

### 6.4 External Port Exposure

Optional: expose database port on host for external tools (pgAdmin, DBeaver, etc.):
- Map to `externalPort` field on `databaseConfig` table
- Warn user about security implications
- Recommend SSH tunnel instead for production

### 6.5 Custom Configuration

Users can pass custom config snippets:
- PostgreSQL: mount custom `postgresql.conf` or pass via `-c` flags
- Redis: mount custom `redis.conf`
- MySQL: mount custom `my.cnf`
- Store in `customConfig` JSONB field on `databaseConfig` table

### 6.6 Version Selection

- User picks image tag from a curated list (e.g., postgres:14, postgres:15, postgres:16)
- Default to latest stable
- **Version upgrade flow** (integrates with Section 10 backup system):
  1. Warn user about potential incompatibility
  2. **Automatically trigger a backup** (Section 10.1) before proceeding
  3. Wait for backup to complete successfully. If backup fails, abort upgrade.
  4. Scale service to 0 (stop database)
  5. Update Swarm service with new image tag
  6. Scale service to 1 (start with new version)
  7. Run health check — verify database accepts connections
  8. On health check failure: auto-restore from the pre-upgrade backup, revert to old image tag
  9. Log upgrade result to audit trail

### 6.7 Database Provisioning Pipeline

Database resources follow a simplified version of the deployment pipeline (Section 4):
- Database create/update operations are Inngest functions (not the same 10-step pipeline as apps)
- States: `provisioning` → `running` → `failed`
- On create: generate credentials → create volume → create Swarm service → health check
- On config change: update Swarm service spec (env vars, resource limits, custom config)
- On version upgrade: follow the 6.6 upgrade flow
- On delete: stop service → optionally backup → remove service → remove volume
- Rollback on failure: if health check fails after provisioning, remove the service and mark resource as `failed`

---

## Section 7: Environment Variables & Secrets

**Packages:** `packages/secrets/` + `packages/domain/`

### 7.1 Env Var CRUD

Full create/read/update/delete at three scopes:
- **Project scope**: applies to all environments and resources in the project
- **Environment scope**: applies to all resources in a specific environment
- **Resource scope**: applies to a single resource

### 7.2 Scope Inheritance

Resolution order (later overrides earlier):
1. Project-level vars
2. Environment-level vars
3. Resource-level vars

Same key at a narrower scope overrides the broader scope.

### 7.3 Secret Encryption & Handling

- Sensitive values encrypted at rest using `encryptedValue` column
- Encryption key: dedicated `ENCRYPTION_KEY` env var (not shared with auth secret)
- AES-256-GCM for authenticated encryption
- Never log or expose decrypted values in API responses (mask with `***`)

**Log redaction policy:**
- All deployment/build log streams pass through a redaction filter before storage
- Redact known secret patterns: env var values marked `isSecret`, connection strings, API keys, tokens
- Regex-based pattern matching for common secret formats (AWS keys, JWT tokens, Bearer tokens, basic auth)
- Redacted values replaced with `[REDACTED]`
- Redaction applied in the build log streaming layer (Section 2.7) and deployment event writes

**Key rotation process:**
- Support rotating `ENCRYPTION_KEY` via a CLI command: `otterdeploy rotate-key --old <old> --new <new>`
- Re-encrypts all `encryptedValue` entries and secret snapshots with the new key
- Atomic: runs in a transaction, rolls back if any re-encryption fails
- Old key rejected after rotation completes

### 7.4 Infisical Integration

For organizations with Infisical configured (`secretProviderBinding` table):
- Fetch secrets from Infisical using machine identity credentials
- Map Infisical paths to OtterStack scopes via `secretReference` table
- Sync on demand (at deploy time) and cache with TTL
- Fallback to native provider if Infisical is unreachable

### 7.5 Native Secret Provider

Default when no external provider is configured:
- Encrypt/decrypt using local key
- Store in `encryptedValue` column
- No external dependencies

### 7.6 Build-Time vs Runtime

- `isBuildTime: true` — inject as Docker build args during image build
- `isBuildTime: false` (default) — inject as container env vars at runtime
- Some vars may be both (e.g., `NODE_ENV`)

### 7.7 Inter-Resource Reference Resolution

Support `${resourceName.property}` syntax in env var values:
- `${db.connectionString}` → resolved PostgreSQL connection URL
- `${cache.host}` → resolved Redis hostname
- `${cache.port}` → resolved Redis port
- Resolution happens at deploy time (Step 3 of pipeline)

### 7.8 Deployment Secret Snapshot

- At deploy time, freeze all resolved env vars into `deploymentSecretSnapshot`
- **Encrypted at rest**: `entriesJson` column encrypted with `ENCRYPTION_KEY` (AES-256-GCM), not stored as plaintext JSONB
- Immutable record of exactly what config was used for each deployment
- Enables: "what env vars were active during deployment #47?"
- Already have the table — just need the write logic in the pipeline

### 7.9 Bulk Import

- Accept raw `.env` file text via API
- Parse `KEY=value` lines (handle quoting, multiline, comments)
- Create individual `environmentVariable` rows
- Support overwrite vs skip-existing modes

### 7.10 Env Var Diffing

- Compare env vars between two deployments (via their snapshots)
- Return: added keys, removed keys, changed keys (values masked)
- Useful for debugging "what changed between deploys?"

### 7.11 Restart With New Config (No Rebuild)

When env vars change but no new code is deployed, users need a way to apply the new config without a full build cycle:

- **API**: `POST /rpc/resource.restart` — triggers a config-only restart
- **Flow**: resolve current env vars → create new deployment secret snapshot → update Swarm service env vars → Swarm performs rolling restart (start-first) → health check
- **Skips**: clone, build, pre-deploy command (Steps 2, 4, 5 of the pipeline)
- **Creates**: a new `deployment` record with `source: "config_change"` for audit trail
- **UI indicator**: show when running env vars differ from configured env vars (compare last deployment snapshot vs current config). Display a "Restart to apply changes" prompt.

---

## Section 8: Custom Domains & SSL

**Packages:** `packages/domain/` + `packages/proxy/`

### 8.1 Domain CRUD

- Add custom domain to a resource
- Remove domain from a resource
- List domains for a resource
- Domain uniqueness: one domain can only be assigned to one resource across the organization

### 8.2 DNS Verification

Two-phase verification when a domain is added:

**Phase 1: Ownership verification (TXT record)**
1. Generate random verification token
2. Store in `verificationToken` column
3. Instruct user to add TXT record: `_otterstack-verify.example.com` → token
4. Background job polls DNS for the TXT record
5. On match: mark ownership verified

**Phase 2: Traffic readiness (A/CNAME check)**
6. Check that domain's A record or CNAME points to this server's IP
7. Warn user if DNS doesn't resolve to this server (traffic won't route correctly)
8. On both checks passing: set `verified: true`, emit `domain.verified` event
9. Caddy auto-provisions SSL when route is pushed

Phase 2 is advisory (warning, not blocking) — the user may be migrating DNS and wants to pre-configure. But the UI clearly shows whether traffic will actually route.

**Cloudflare proxy detection:** If the A record resolves to a known Cloudflare IP range, warn the user that:
- The domain is behind Cloudflare's proxy (orange cloud)
- SSL will be handled by Cloudflare → Caddy, requiring "Full (Strict)" SSL mode in Cloudflare
- Health checks from OtterStack will see Cloudflare IPs, not the actual server IP
- The A/CNAME check cannot verify the domain points to this server (Cloudflare masks the origin)

### 8.3 Auto-Generated URLs

Domain resolution follows the three-level hierarchy (resource → project → server):

- **Resource custom domain set**: use it directly (e.g., `api.myapp.io`)
- **Project base domain set**: `{resourceName}.{projectBaseDomain}` (e.g., `api.myapp.io` from project domain `myapp.io`)
- **Server base domain fallback**: `{resourceName}-{projectSlug}.{serverBaseDomain}` (e.g., `api-myapp.apps.example.com`)

Examples:
- Server base domain: `apps.example.com` → `api-myapp.apps.example.com`
- Project base domain: `myapp.io` → `api.myapp.io`, `web.myapp.io`, `db.myapp.io`
- Resource custom domain: `api.custom-domain.com` (overrides everything)

No DNS verification needed for auto-generated URLs under wildcard domains.

### 8.4 SSL Status Tracking

- Monitor certificate expiry dates
- Update `sslStatus` (pending, active, failed, expired) and `sslExpiresAt`
- Caddy handles renewal automatically, but OtterStack tracks status for UI display
- Scheduled job to check certificate status via Caddy Admin API

### 8.5 Custom Certificate Upload

- Accept PEM certificate + private key via API
- Validate cert format and expiry
- Push to Caddy TLS config via Admin API `certificates.load_files`
- Store metadata in DB

### 8.6 Force HTTPS

- Default: always redirect HTTP → HTTPS (Caddy does this automatically)
- Optional: disable redirect for specific resources (rare, but needed for some legacy apps)

### 8.7 Domain Conflict Detection

- Before adding a domain, check if it's already assigned to any resource in the organization
- Return clear error: "Domain example.com is already assigned to resource X in project Y"

### 8.8 Redirect Rules

- **WWW redirect**: optional per domain — redirect `www.example.com` → `example.com` (or vice versa)
- **Custom redirect rules** (P1): arbitrary URL redirect rules stored as JSONB on `customDomain`:
  - Source path pattern (string or regex)
  - Target URL
  - Status code (301 permanent, 302 temporary)
  - Example: `/old-blog/*` → `https://blog.example.com/$1` (301)
- Implemented as Caddy subroute handlers within the domain's route
- Redirect rules evaluated before the reverse_proxy handler

---

## Section 9: Monitoring & Health

**Packages:** `packages/domain/` + `apps/worker/`

### 9.1 Container Stats Collection

Scheduled Inngest function (every 30 seconds):
- For each running Swarm service, call Docker stats API
- Collect: CPU %, memory usage/limit, network RX/TX bytes, block I/O
- Aggregate per-service (may have multiple tasks/replicas)

### 9.2 Stats Storage

Store metrics in PostgreSQL:
- Table: `resourceMetric` (new)
- Columns: resourceId, timestamp, cpuPercent, memoryUsed, memoryLimit, networkRx, networkTx, diskRead, diskWrite
- Retention: keep 7 days of per-minute data, 90 days of per-hour aggregates

**Scale plan for PostgreSQL performance:**
- **Partitioning**: partition `resourceMetric` by time range (daily partitions) using PostgreSQL declarative partitioning
- **Indexes**: composite index on `(resourceId, timestamp DESC)` for dashboard queries
- **Rollup job**: scheduled Inngest function (hourly) aggregates raw 30s data into `resourceMetricHourly` table (avg, min, max, p95 per metric)
- **Retention job**: scheduled Inngest function (daily) drops partitions older than 7 days for raw data, 90 days for hourly aggregates
- **Row budget**: ~2,880 rows/resource/day at 30s intervals. For 100 resources = ~288K rows/day, ~2M rows/week. Partitioning keeps queries fast by scanning only relevant partitions
- Scheduled cleanup job prunes old rows

### 9.3 Container Health Status

Map Docker/Swarm task state to `resourceStatusEnum`:
- Swarm task `running` + health check `healthy` → `online`
- Swarm task `running` + health check `unhealthy` → `degraded`
- Swarm task `failed` or `shutdown` → `crashed`
- Swarm task `preparing` or `starting` → `deploying`
- Service replicas = 0 → `stopped`

### 9.4 Health Status Change Events

When a resource's health status changes:
- Emit `resource.health.changed` Inngest event
- Update `status` column on `projectResource` table
- Trigger notification to configured channels
- Log to audit trail

### 9.5 Resource Status Dashboard API

`GET /rpc/monitoring.getResourceStatus`
- Input: projectId, environmentId
- Output: all resources with current status, CPU %, memory %, last health check time
- Used by the UI observability page

### 9.6 Log Streaming (Implement Stubbed API)

`GET /rpc/deployment.streamLogs`
- Read from Docker service logs API: `docker.getService(name).logs()`
- Support `tail` (last N lines), `since` (timestamp), `follow` (stream)
- Return paginated log lines with timestamps and stream type (stdout/stderr)
- For real-time: SSE or WebSocket endpoint

### 9.7 Log Persistence

- Docker retains container logs by default (json-file driver)
- Configure log rotation: max 50MB per file, max 5 files per container
- For historical logs beyond container lifetime: store deployment logs in `deploymentEvent` table
- No separate log storage system needed for MVP

**Log drains (P2):** For production users with centralized logging needs, support configuring Docker's logging driver per service (e.g., `fluentd`, `gelf`, `syslog`) to ship logs to external providers (Loki, Datadog, Axiom, New Relic). Alternatively, deploy a Fluent Bit sidecar container for log aggregation and forwarding.

### 9.8 Deployment Log Viewer

`GET /rpc/deployment.getLogs`
- Input: deploymentId
- Output: all `deploymentEvent` rows for this deployment, ordered by timestamp
- Includes: build output, deploy events, health check results, routing updates

### 9.9 Alert Thresholds

- Configurable per resource (store in metadata JSONB):
  - CPU threshold (e.g., alert if > 90% for 5 minutes)
  - Memory threshold (e.g., alert if > 85% of limit)
  - Restart count threshold (e.g., alert if > 3 restarts in 10 minutes)
- Threshold evaluation in the stats collection Inngest function
- On breach: emit `resource.alert.triggered` event → notifications

### 9.10 Container Restart Detection

- Monitor Swarm task restart count
- When count increments: log event, check if threshold breached
- Show restart history in resource detail panel

### 9.11 Uptime Tracking

- Track transitions between `online` and `degraded`/`crashed`/`stopped`
- Calculate uptime percentage over configurable windows (24h, 7d, 30d)
- Store transitions in `resourceMetric` or dedicated `uptimeEvent` table

### 9.12 Server-Level Health Monitoring

Monitor the host server itself (not just containers):

- **Docker daemon**: periodic connectivity check via Docker socket. Update `server.status` and `server.lastSeenAt`.
- **Disk space**: check `/var/lib/docker` usage. Integrate with Section 1.8 threshold alerts.
- **Host CPU & memory**: collect via `os.cpus()` and `os.freemem()` (or `docker info` system stats).
- **Swarm status**: verify Swarm is active, node is healthy.
- **Caddy status**: verify Caddy service is running and Admin API is responsive. If Caddy is missing or crashed, auto-restart the Caddy Swarm service (self-healing).
- **Network connectivity**: verify `otterstack-ingress` network exists, Caddy is connected to all project networks.

Scheduled Inngest function (every 60 seconds):
- On server unreachable: emit `server.unreachable` event → notification
- On server recovered: emit `server.recovered` event → notification
- On Caddy down: attempt auto-restart, emit `proxy.restarted` or `proxy.failed` event

### 9.13 Scheduled Task Execution (Cron Jobs)

Run user-defined commands inside running containers on a cron schedule:

- **Schema**: the existing `cronSchedule` field on `projectResource` stores the cron expression. Add `cronCommand` (text) for the command to run.
- **Execution**: Inngest scheduled function evaluates cron expressions, runs `docker exec` into the target service's container
- **Logging**: capture stdout/stderr, exit code, duration. Store in a `scheduledTaskExecution` table.
- **Timeout**: configurable per task (default: 5 minutes). Kill if exceeded.
- **Failure notifications**: emit `scheduledTask.failed` event on non-zero exit code → notify
- **UI**: show execution history with status, output, and next scheduled run

---

## Section 10: Backup System

**Packages:** `packages/domain/` + `apps/worker/`

### 10.1 Database Backup Adapters

Per-database-type backup commands executed via `docker exec`:

| Database | Backup Command | Restore Command |
|----------|---------------|-----------------|
| PostgreSQL | `pg_dump -U {user} -d {dbname} \| gzip` | `gunzip \| psql -U {user} -d {dbname}` |
| MySQL | `mysqldump -u {user} -p{pass} {dbname} \| gzip` | `gunzip \| mysql -u {user} -p{pass} {dbname}` |
| MongoDB | `mongodump --archive --gzip -u {user} -p {pass} -d {dbname}` | `mongorestore --archive --gzip` |
| Redis | Trigger `BGSAVE`, copy `/data/dump.rdb` from volume | Copy `dump.rdb` to volume, restart |

### 10.2 Volume Backup

For `kind: volume` resources:
- Stop containers using the volume (optional, for consistency)
- Mount volume in a temporary container
- `tar czf /backup/volume.tar.gz /data`
- Copy tar out of container
- Restart stopped containers

### 10.3 Backup Scheduling

Inngest cron functions per backup schedule:
- Cron expression stored per resource (e.g., `0 2 * * *` for daily at 2 AM)
- Each resource can have its own schedule
- Inngest handles scheduling, retries on failure

### 10.4 Local Backup Storage

- Default: store backups on server filesystem at `/var/lib/otterstack/backups/`
- Directory structure: `/{organizationId}/{resourceId}/{timestamp}.{ext}`
- Track in `backup` table: path, size, checksum (SHA256), timestamps

### 10.5 S3-Compatible Upload

After local backup completes, optionally upload to S3-compatible storage:
- Use AWS SDK v3 (`@aws-sdk/client-s3`) with custom endpoint support
- Supports: AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, Backblaze B2, Wasabi
- S3 config stored per organization (bucket, region, endpoint, access key, secret key)
- Upload with server-side encryption (SSE-S3)

### 10.6 Retention Policies

Three-dimensional retention (evaluated after each backup):
- **Count-based**: keep last N backups (e.g., last 10)
- **Age-based**: delete backups older than N days (e.g., 30 days)
- **Size-based**: delete oldest when total exceeds N GB (e.g., 50 GB)

Apply to both local and S3 storage independently.

### 10.7 Backup Status Tracking

`backup` table status flow:
- `pending` → `running` → `completed` (with size, duration, checksum)
- `pending` → `running` → `failed` (with error message)
- Track both local and S3 upload status

### 10.8 Restore from Backup

1. User selects a backup to restore from
2. Download from S3 if not available locally
3. Stop the database service (scale to 0)
4. Execute restore command via `docker exec` on a temporary container
5. Restart the database service (scale to 1)
6. Verify health check passes
7. Log restore action to audit trail

### 10.9 Manual Backup Trigger

- API endpoint: `POST /rpc/backup.create`
- Creates a backup immediately (outside of schedule)
- Same flow as scheduled backup

### 10.10 Backup Encryption

Optional: encrypt backup files before storage:
- AES-256-GCM encryption using organization's encryption key
- Encrypt before S3 upload (defense in depth, on top of SSE-S3)
- Store encryption metadata in backup record

### 10.11 Control-Plane Disaster Recovery

Backup OtterStack's own state (not just user resources):

- **OtterStack PostgreSQL database**: scheduled `pg_dump` of the control-plane DB itself, uploaded to S3
- **Caddy config state**: backup `/config/caddy/autosave.json` and `/data/caddy/` (certificates) as a volume backup
- **Encryption key recovery**: document and enforce that `ENCRYPTION_KEY` is stored securely outside OtterStack (e.g., in a password manager or HSM). Without it, encrypted secrets and snapshots are unrecoverable.
- **Recovery workflow**:
  1. Restore PostgreSQL from backup
  2. Restore Caddy volumes
  3. Provide `ENCRYPTION_KEY`
  4. Run `otterdeploy recover` — verifies DB integrity, reconnects to Swarm, resyncs Caddy routes from DB
- **Recovery drill**: documented procedure to validate full restore on a fresh server

---

## Section 11: Server Setup & System Bootstrap

**Packages:** `packages/domain/` + `apps/server/`

First-run experience when OtterStack starts on a fresh server.

### 11.1 Docker Installation Check

On startup:
- Check if Docker Engine is installed: `docker info`
- Check Docker version meets minimum (24.0+)
- Check Docker daemon is running
- If Docker is missing: show setup wizard with installation instructions

### 11.2 Docker Swarm Initialization

- Check if Swarm is active: `docker info --format '{{.Swarm.LocalNodeState}}'`
- If not active: `docker.swarmInit({ ListenAddr: "127.0.0.1:2377" })` — **bind to localhost only**, Swarm manager port never internet-exposed
- Create `otterstack-ingress` overlay network (for Caddy → project network routing)
- Store Swarm node ID in system config

### 11.3 Caddy Container Bootstrap

- Check if Caddy service exists in Swarm
- If not: create Caddy service (see Section 5.5)
- Verify Caddy Admin API is responsive: `GET http://localhost:2019/config/`
- Push initial config with admin API enabled

### 11.4 Nixpacks Installation

- Check if `nixpacks` binary exists in PATH
- If not: download and install
- Verify: `nixpacks --version`

### 11.5 OtterStack Networks

- `otterstack-ingress`: overlay network connecting Caddy to all project networks
- `otterstack-proj-{projectId}`: per-project overlay networks for tenant isolation
- Enables DNS-based service discovery between containers within the same project
- Cross-project traffic blocked by network boundary
- Created during Swarm init (ingress) and project creation (project networks), verified on every startup

### 11.6 System Health Endpoint

`GET /api/system/health`

Returns status of all dependencies:
```json
{
  "docker": { "status": "ok", "version": "24.0.7", "swarm": "active" },
  "caddy": { "status": "ok", "version": "2.8.4", "adminApi": true },
  "database": { "status": "ok", "latency": "2ms" },
  "inngest": { "status": "ok" },
  "zero": { "status": "ok" }
}
```

### 11.7 Setup Wizard API

Step-by-step first-run configuration:
1. Create admin user account
2. Create default organization
3. Configure server domain (for auto-generated URLs)
4. Configure ACME email (for Let's Encrypt SSL)
5. Optional: configure S3 backup destination
6. Optional: configure notification channels
7. Initialize Docker Swarm + Caddy

### 11.8 Port Availability Check

Verify required ports are available before starting:
- 80 (HTTP) — public, bound to `0.0.0.0`
- 443 (HTTPS) — public, bound to `0.0.0.0`
- 2019 (Caddy Admin API) — **localhost only** (`127.0.0.1`), verified not exposed to public interfaces
- 2377 (Swarm manager) — **localhost only** (`127.0.0.1`), verified not exposed to public interfaces
- Warn if ports are in use, suggest resolution
- **Security check**: automated test asserts 2019 and 2377 are not reachable from external interfaces

### 11.9 Future Multi-Node Migration Path

Current design is intentionally single-node and localhost-bound for control-plane safety.
If/when moving to multi-node Swarm:

1. Reconfigure Swarm manager `ListenAddr` from `127.0.0.1:2377` to a private/VPN interface only.
2. Enforce network ACLs/firewall rules so `2377` is reachable only from approved cluster nodes.
3. Keep Caddy Admin API on localhost-only (`127.0.0.1:2019`) regardless of node count.
4. Add node join/leave runbooks and certificate/key rotation procedures.
5. Re-run Section 16 security acceptance checks before enabling multi-node in production.

### 11.10 Self-Update Mechanism

How OtterStack updates itself to new versions:

- OtterStack runs as a set of Swarm services (server, worker, web) using OtterStack Docker images
- **Update check**: scheduled Inngest function checks for new image tags from the OtterStack container registry (e.g., `ghcr.io/otterstack/otterstack:latest`)
- **Update notification**: emit `system.update.available` event → notification to admin
- **Update execution** (admin-triggered, never automatic):
  1. Pull new OtterStack images
  2. Run database migrations (if any)
  3. Update Swarm services one at a time (server → worker → web) with `start-first` for zero-downtime
  4. Verify health checks pass on each service before proceeding to next
  5. On failure: auto-rollback to previous image tags
- **Version pinning**: admin can configure a specific version tag instead of `latest`
- **Changelog display**: fetch release notes from GitHub releases API, show in settings UI

---

## Section 12: Notification System

**Packages:** `packages/domain/` + `apps/worker/`

### 12.1 Notification Dispatcher

Central function that routes events to configured channels:
1. Receive event (e.g., `deployment.released`, `resource.health.changed`)
2. Look up notification channels for this organization
3. Filter by channel preferences (which events go to which channel)
4. Dispatch to each matching channel adapter

### 12.2 Channel Adapters

| Channel | Method | Payload | Priority |
|---------|--------|---------|----------|
| **Slack** | POST to webhook URL | Slack Block Kit message | P0 |
| **Discord** | POST to webhook URL | Discord embed object | P0 |
| **Email (SMTP)** | SMTP send via nodemailer | HTML email template | P0 |
| **Generic Webhook** | POST to user URL | JSON payload with event data | P0 |
| **Telegram** | POST to Telegram Bot API | Markdown-formatted message | P1 |

### 12.3 Notification Events

| Event | Trigger |
|-------|---------|
| Deployment succeeded | `deployment.released` |
| Deployment failed | `deployment.failed` |
| Resource health changed | `resource.health.changed` |
| Backup completed | `backup.completed` |
| Backup failed | `backup.failed` |
| Resource alert triggered | `resource.alert.triggered` (CPU/memory threshold) |

### 12.4 Channel CRUD

- Create channel with type, name, config (webhook URL, SMTP settings, etc.)
- Update channel config
- Delete channel
- Per-organization

### 12.5 Test Notification

- Send a test message to verify channel configuration
- Returns success/failure with error details if failed

### 12.6 Notification Preferences

- Per-channel event filtering stored in `config` JSONB
- Example: Slack gets deploy events only, email gets everything
- Default: all events to all channels

---

## Section 13: Audit Logging

**Package:** `packages/domain/`

### 13.1 Audit Log Writes

Record all mutating actions:
- **Actor**: userId, IP address, user agent
- **Action**: create, update, delete, deploy, rollback, backup, restore
- **Entity**: entityType (project, resource, deployment, etc.) + entityId
- **Metadata**: JSONB with action-specific details (what changed)
- **Timestamp**: when the action occurred

### 13.2 Audit Log Queries

`GET /rpc/audit.list`
- Filter by: userId, entityType, entityId, action, date range
- Paginated results, ordered by timestamp descending
- Used by: settings page audit trail

### 13.3 Key Audited Actions

- Project/environment/resource create/update/delete
- Deployment trigger/cancel/rollback
- Server registration/removal
- SSH key creation/deletion
- Domain add/remove/verify
- Env var create/update/delete (values never logged)
- Backup trigger/restore
- Notification channel changes
- Auth events: login, step-up verification

### 13.4 Retention Policy

- Configurable per organization: keep audit logs for N days (default: 90)
- Scheduled Inngest job to prune expired audit log rows

---

## Section 14: API Completion

**Package:** `packages/api/`

Finish all stubbed/incomplete routers.

### 14.1 `deployment.streamLogs`

Currently returns empty array. Implement:
- Read from Docker service logs API
- Support pagination (offset + limit)
- Support tail (last N lines)
- Support since (timestamp filter)

### 14.2 `resourceLink` Router

Complete CRUD:
- Create link (sourceResourceId, targetResourceId, linkType)
- Delete link
- List links for an environment
- Validate: no circular dependencies, valid link types for resource kinds

### 14.3 `environmentVariable` Router

Complete CRUD:
- Create/update/delete at project/environment/resource scope
- List with inheritance resolution (show effective vars for a resource)
- Bulk import from `.env` text

### 14.4 `domain` Router

Complete:
- Add domain to resource
- Remove domain
- Verify domain (trigger DNS check)
- List domains for resource
- Check domain availability

### 14.5 `gitProvider` Router

Complete:
- Register GitHub App (OAuth flow)
- List repos for a provider
- Configure repo for a resource (branch, root dir, auto-deploy)
- Test webhook connectivity

### 14.6 `monitoring` Router

New:
- Get resource stats (CPU, memory, network over time range)
- Get resource current status
- Get project health summary
- Configure alert thresholds

### 14.7 `backup` Router

New:
- Trigger manual backup
- List backups for a resource
- Restore from backup
- Configure backup schedule
- Configure S3 destination

### 14.8 `audit` Router

Complete:
- List audit logs with filters
- Get audit log entry by ID

### 14.9 `system` Router

Complete:
- Health check endpoint
- Setup wizard endpoints
- Server bootstrap status
- Docker/Caddy/Inngest connectivity status

### 14.10 Webhook Endpoint

New: `POST /api/webhooks/github`
- HMAC signature validation
- Parse push/PR events
- Route to auto-deploy logic

---

## Section 15: Database Schema Additions

**Package:** `packages/db/`

### 15.1 New Tables

**`resourceMetric`** — time-series container stats:
```
id, resourceId, timestamp, cpuPercent, memoryUsed, memoryLimit,
networkRx, networkTx, diskRead, diskWrite
```

**`caddyInstance`** — Caddy container status per server (from design doc):
```
id, serverId, organizationId, status, version, acmeEmail,
lastHealthCheckAt, errorMessage, metadata, createdAt, updatedAt
```

**`backupSchedule`** — backup configuration per resource:
```
id, resourceId, organizationId, cronExpression, enabled,
retentionCount, retentionDays, retentionMaxSizeGb,
s3Bucket, s3Region, s3Endpoint, s3AccessKeyRef, s3SecretKeyRef,
createdAt, updatedAt
```

**`webhookDelivery`** — replay protection for GitHub webhooks:
```
id (text, GitHub's X-GitHub-Delivery header), receivedAt (timestamp),
createdAt (timestamp, for TTL cleanup)
```
72-hour TTL, scheduled cleanup job prunes expired rows.

**`resourceMetricHourly`** — rollup aggregates for dashboard queries:
```
id, resourceId, timestamp (hourly bucket),
cpuAvg, cpuMax, cpuP95,
memoryAvg, memoryMax, memoryP95,
networkRxTotal, networkTxTotal, diskReadTotal, diskWriteTotal
```

**`containerRegistry`** — Docker registry credentials:
```
id, organizationId, name, url, username, passwordSecretRef,
isDefault, createdAt, updatedAt
```

**`configFile`** — file mounts for containers:
```
id, resourceId, organizationId, filename, content (text),
mountPath, createdAt, updatedAt
```

**`scheduledTaskExecution`** — cron job execution history:
```
id, resourceId, organizationId, command, cronExpression,
status (pending/running/completed/failed), exitCode,
stdout, stderr, duration, startedAt, completedAt
```

### 15.2 Enum Extensions

- **`buildMethodEnum`**: existing values are `nixpacks`, `dockerfile`, `buildpack`. Changes:
  - Add: `docker_image`, `static`, `compose`
  - Keep: `buildpack` (existing rows may reference it; Heroku/Paketo buildpack support is P1)
  - Final target values: `nixpacks`, `dockerfile`, `buildpack`, `docker_image`, `static`, `compose`
- **`builderEnum`**: existing values include `railpack`. Keep as-is for forward-compatibility (P2 builder).
- **`resourceKindEnum`**: add `compose` for multi-container stack resources
- **`deploymentSourceEnum`**: add `preview`, `config_change` values
- **`caddyStatusEnum`** (new): `not_installed`, `initializing`, `running`, `stopped`, `error`

### 15.3 Column Additions

- **`gitRepository`**: add `watchPaths` (text array) for monorepo path filtering
- **`server`**: add `swarmNodeId` (text), `baseDomain` (text), `acmeEmail` (text), `dockerCleanupThreshold` (integer, default 80)
- **`project`**: add `baseDomain` (text, nullable) — project-level domain override (e.g., `myapp.io`)
- **`projectResource`**: add `cronCommand` (text, nullable) for scheduled task command, `registryId` (FK to `containerRegistry`, nullable), `composeFile` (text, nullable) for compose resources
- **`customDomain`**: add `redirectRules` (JSONB, nullable) for custom redirect rules
- **`notificationChannel`**: add `eventFilter` (JSONB) for per-channel event preferences

### 15.4 Migration & Rollout Strategy

- All schema changes use Drizzle migrations (`db:generate` + `db:migrate`)
- Migrations must be backward-compatible: add columns as nullable with defaults, never drop columns in the same release that removes code references
- Rollout sequence: deploy migration → deploy code that reads new columns → backfill data → deploy code that writes new columns
- Feature flags for new functionality that depends on new schema (e.g., backup scheduling, metrics collection)
- Each section's schema changes are grouped into a single migration file, ordered by dependency

---

## Implementation Priority

### P0 — Foundation (must have for any deploy to work)

| # | Section | Dependency |
|---|---------|-----------|
| 1 | Section 11: Server Setup & Bootstrap | None — first thing that runs |
| 2 | Section 1: Docker Infrastructure Layer | Depends on server setup |
| 3 | Section 15: Database Schema Additions | Parallel with Docker layer |
| 4 | Section 2: Build System (Nixpacks + Dockerfile) | Depends on Docker layer |
| 5 | Section 3: Git Integration (GitHub App + webhooks) | Parallel with build system |
| 6 | Section 7: Environment Variables & Secrets | Parallel with build system |
| 7 | Section 4: Deployment Pipeline | Depends on build, git, docker, secrets |
| 8 | Section 5: Reverse Proxy (Caddy) | Depends on Docker layer |
| 9 | Section 6: Database Provisioning (PostgreSQL + Redis first) | Depends on Docker layer |
| 10 | Section 8: Custom Domains & SSL | Depends on Caddy |
| 11 | Section 16 P0: Hardening Gates | Cross-cutting across Sections 1, 3, 4, 5, 7, 11 |

### P1 — Operations (needed for production-grade usage)

| # | Section | Dependency |
|---|---------|-----------|
| 12 | Section 9: Monitoring & Health | Depends on Docker layer |
| 13 | Section 10: Backup System | Depends on Docker layer + DB provisioning |
| 14 | Section 12: Notification System | Depends on Inngest events from pipeline |
| 15 | Section 13: Audit Logging | Parallel with everything |
| 16 | Section 14: API Completion | Depends on domain logic from all sections |
| 17 | Section 16 P1: Readiness Gates | Depends on Sections 4, 8, 9, 10, 15 |

### Dependency Graph

```
Server Setup (11)
    |
    v
Docker Layer (1) + Schema (15)
    |
    +--> Build System (2) ----+
    |                          |
    +--> Git Integration (3) --+--> Deployment Pipeline (4)
    |                          |
    +--> Env Vars (7) --------+
    |
    +--> Caddy Proxy (5) --> Domains (8)
    |
    +--> DB Provisioning (6)
    |
    +--> Monitoring (9)
    |
    +--> Backups (10)
    |
    +--> Hardening Gates (16)

Notifications (12), Audit (13), API Completion (14) — parallel, low dependency
Production rollout gate: Section 16 P0 must be complete.
```

---

## New Packages to Create

| Package | Purpose |
|---------|---------|
| `packages/docker/` | Docker Engine + Swarm client (Dockerode wrapper), config/secret management |
| `packages/builder/` | Build system adapters (Nixpacks, Dockerfile, Docker Image, Static, Compose) |
| `packages/git/` | Git provider abstraction + adapters (GitHub App, generic clone, webhook handler) |
| `packages/proxy/` | Caddy Admin API client, route builder, sync orchestration |

---

## Total Item Count

| Section | Items |
|---------|-------|
| 1. Docker Infrastructure | 14 |
| 2. Build System | 15 |
| 3. Git Integration | 15 |
| 4. Deployment Pipeline | 18 |
| 5. Reverse Proxy (Caddy) | 17 |
| 6. Database Provisioning | 13 |
| 7. Env Vars & Secrets | 11 |
| 8. Custom Domains & SSL | 9 |
| 9. Monitoring & Health | 15 |
| 10. Backup System | 11 |
| 11. Server Setup | 10 |
| 12. Notifications | 7 |
| 13. Audit Logging | 4 |
| 14. API Completion | 10 |
| 15. Schema Additions | 8 |
| 16. Hardening Requirements & Validation Gates | 12 |
| **Total** | **~189 items** |

---

## Section 16: Hardening Requirements & Validation Gates

**Status:** Release gate before production rollout  
**Why:** These controls close critical reliability and security gaps and must be validated, not just documented.

### 16.1 P0 Requirements (Blockers)

| # | Requirement | Implementation Location |
|---|-------------|--------------|
| 1 | **Tenant network isolation model**: avoid one shared flat network for all tenants. At minimum, isolate by environment/project and document cross-resource networking rules. | Section 1.2, 1.5, 4.7 |
| 2 | **Control-plane port hardening**: explicitly bind and firewall Caddy Admin API (`2019`) and Swarm manager (`2377`) to trusted interfaces only; never internet-exposed. | Section 5.5, 11.2, 11.8 |
| 3 | **Webhook replay and dedupe**: persist webhook delivery IDs, enforce replay window, reject duplicates, keep idempotent side effects. | Section 3.2, 3.11 |
| 4 | **Pipeline idempotency**: every step must be safe on retry (`clone`, `build`, `route`, `cleanup`) with deterministic idempotency keys. | Section 4.1 |
| 5 | **Explicit rollback config**: define Swarm `UpdateConfig` + `RollbackConfig` (`failure_action`, monitor window, parallelism, max failure ratio). | Section 4.7, 4.8 |
| 6 | **Secrets handling hardening**: enforce log redaction policy, redact all known secret patterns from deployment/build logs, encrypt snapshots at rest, and define key rotation process. | Section 4.4, 7.3, 7.8 |

### 16.2 P1 Requirements (Production Readiness)

| # | Requirement | Implementation Location |
|---|-------------|--------------|
| 7 | **Atomic proxy updates**: remove delete-then-add route mutations that can cause brief downtime; use atomic config load or optimistic-lock update strategy. | Section 5.1, 5.9 |
| 8 | **Domain cutover validation**: TXT verification alone is insufficient; add optional A/AAAA/CNAME target checks before routing traffic. | Section 8.2 |
| 9 | **Deployment queue semantics**: define ordering policy (FIFO/LIFO), superseded-commit collapse, TTL, and cancellation behavior for queued jobs. | Section 4.2, 4.15 |
| 10 | **Metrics storage scale validation**: verify indexing/partitioning/rollup jobs for `resourceMetric` under 30s collection cadence with load tests and retention checks. | Section 9.2, 15.1 |
| 11 | **Control-plane disaster recovery**: backup/restore OtterStack DB, Caddy config state, and encryption-key recovery workflow. | Section 10 |
| 12 | **Schema rollout execution**: apply migration ordering, feature flags, backfills, and rollback-safe deployment sequence in staged environments. | Section 15 |

### 16.3 Acceptance Criteria (Must Be Verifiable)

1. **Security checks**
   - Automated test asserts ports `2019` and `2377` are not publicly reachable.
   - Redaction tests prove no secret values leak into deployment events/log streams.
2. **Reliability checks**
   - Webhook replay test with same delivery ID results in exactly one deployment.
   - Forced failure during rolling update auto-rolls back to prior healthy version.
3. **Operational checks**
   - Queue behavior is deterministic and documented; stale queued jobs expire.
   - Metrics retention jobs maintain target row counts and query latency budgets.
4. **Recovery checks**
   - Full restore drill validates recovery of app data **and** control plane state.
5. **Rollout checks**
   - Migrations run forward/backward safely in staging with feature flags enabled.

### 16.4 Definition of Done Update

Do not mark this design as production-ready until all Section 16 P0 items are implemented and tested.  
P1 items may ship behind feature flags but must be tracked as release-blocking for general availability.
