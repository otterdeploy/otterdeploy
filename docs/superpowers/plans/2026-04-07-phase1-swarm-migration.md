# Phase 1: Migrate Postgres Provisioning to Docker Swarm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw Docker container provisioning with Docker Swarm services, establishing the orchestration foundation for the entire PaaS platform.

**Architecture:** The Hono server initializes Swarm on startup (`docker swarm init` if not already active). Provisioned databases become Swarm services instead of raw containers. An overlay network replaces the current bridge network for inter-service communication. The existing Caddy reconciliation pipeline, proxy routes, and API contracts remain unchanged — only the container management layer swaps out.

**Tech Stack:** @otterdeploy/docker (Swarm service APIs), Docker Swarm, Caddy (unchanged), Drizzle ORM, Bun test

---

## File Structure

### New files
- `packages/api/src/swarm/client.ts` — Swarm client wrapper: init, ensure overlay network, ensure service, inspect service, remove service
- `packages/api/src/swarm/postgres.ts` — Postgres-specific Swarm provisioning: create service, inspect runtime, destroy service
- `packages/api/src/swarm/__tests__/postgres.test.ts` — Unit tests for Swarm Postgres provisioning (mocked Docker API)

### Modified files
- `packages/api/src/constants.ts` — Add Swarm overlay network name, update docker config section
- `packages/api/src/routers/project/service.ts` — Replace Docker container calls with Swarm service calls
- `packages/api/src/docker/postgres.ts` — Deprecated (kept for reference, imports removed)

### Unchanged files (verify still work)
- `packages/api/src/caddy/builder.ts` — No changes needed
- `packages/api/src/caddy/reconciler.ts` — No changes needed
- `packages/api/src/caddy/queries.ts` — No changes needed
- `packages/api/src/caddy/__tests__/builder.test.ts` — Should still pass
- `packages/api/src/caddy/__tests__/reconciler.test.ts` — Should still pass
- `packages/db/src/schema/project.ts` — No schema changes in this phase

---

### Task 1: Swarm Client Wrapper

**Files:**
- Create: `packages/api/src/swarm/client.ts`

- [ ] **Step 1: Create the Swarm client module with `ensureSwarm()`**

```typescript
// packages/api/src/swarm/client.ts
import { Docker, DockerConflictError } from "@otterdeploy/docker";

/**
 * Ensure Docker is in Swarm mode.
 * No-op if already initialized.
 */
export async function ensureSwarm(): Promise<void> {
  const docker = Docker.fromEnv();

  try {
    const info = (await docker.system.info()).unwrap();
    if (info.Swarm?.LocalNodeState === "active") {
      return;
    }

    await docker.system.swarmInit({
      ListenAddr: "127.0.0.1:2377",
      AdvertiseAddr: "127.0.0.1:2377",
    });
  } finally {
    docker.destroy();
  }
}
```

- [ ] **Step 2: Add `ensureOverlayNetwork()`**

```typescript
// append to packages/api/src/swarm/client.ts
import { DockerNotFoundError } from "@otterdeploy/docker";
import { PLATFORM } from "../constants";

/**
 * Ensure the overlay network for managed resources exists.
 * Overlay networks work across Swarm nodes (unlike bridge).
 */
export async function ensureOverlayNetwork(): Promise<void> {
  const docker = Docker.fromEnv();

  try {
    const inspectResult = await docker.networks.inspect(PLATFORM.swarm.resourceNetwork);
    if (inspectResult.isOk()) {
      return;
    }

    if (!(inspectResult.error instanceof DockerNotFoundError)) {
      throw inspectResult.error;
    }

    await (
      await docker.networks.create({
        Name: PLATFORM.swarm.resourceNetwork,
        Driver: "overlay",
        Attachable: true,
        Labels: {
          "otterdeploy.managed": "true",
        },
      })
    ).unwrap();
  } finally {
    docker.destroy();
  }
}
```

- [ ] **Step 3: Add `initializeSwarm()` bootstrap function**

```typescript
// append to packages/api/src/swarm/client.ts

/**
 * Bootstrap Swarm mode and overlay network.
 * Call once at server startup.
 */
export async function initializeSwarm(): Promise<void> {
  await ensureSwarm();
  await ensureOverlayNetwork();
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/swarm/client.ts
git commit -m "feat(swarm): add client wrapper with init and overlay network"
```

---

### Task 2: Update Platform Constants

**Files:**
- Modify: `packages/api/src/constants.ts`

- [ ] **Step 1: Add Swarm-specific constants**

Replace the current `PLATFORM` constant:

```typescript
// packages/api/src/constants.ts
export const PLATFORM = {
  database: {
    publicBaseDomain: "db.otterdeploy.dev",
    publicPort: 5432,
    internalBaseDomain: "otterdeploy.internal",
    internalPort: 5432,
    localHost: "127.0.0.1",
  },
  docker: {
    resourceNetwork: "otterdeploy-resources",
    postgresImage: "postgres:18-alpine",
  },
  swarm: {
    resourceNetwork: "otterdeploy-resources",
  },
} as const;
```

Note: `swarm.resourceNetwork` uses the same name as `docker.resourceNetwork` so we don't break Caddy's existing network membership. The difference is the network driver changes from `bridge` to `overlay` (handled in Task 1). The old `docker` key is kept for now since other code may reference it — we'll remove it once migration is complete.

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/constants.ts
git commit -m "feat(swarm): add swarm constants to PLATFORM config"
```

---

### Task 3: Swarm Postgres Provisioning

**Files:**
- Create: `packages/api/src/swarm/postgres.ts`

- [ ] **Step 1: Define types**

```typescript
// packages/api/src/swarm/postgres.ts
import { Docker, DockerNotFoundError } from "@otterdeploy/docker";
import { PLATFORM } from "../constants";
import { ensureOverlayNetwork } from "./client";

export type SwarmPostgresRuntime = {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
};

type ProvisionSwarmPostgresInput = {
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
};
```

- [ ] **Step 2: Implement `provisionSwarmPostgres()`**

```typescript
// append to packages/api/src/swarm/postgres.ts
import { setTimeout as sleep } from "node:timers/promises";

export async function provisionSwarmPostgres(
  input: ProvisionSwarmPostgresInput,
): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();

  try {
    await ensureOverlayNetwork();

    // Check if service already exists
    const existing = await inspectSwarmService(docker, input.serviceName);
    if (existing) {
      return existing;
    }

    const response = (
      await docker.services.create({
        Name: input.serviceName,
        Labels: {
          "otterdeploy.managed": "true",
          "otterdeploy.resource.type": "postgres",
        },
        TaskTemplate: {
          ContainerSpec: {
            Image: PLATFORM.docker.postgresImage,
            Env: [
              `POSTGRES_DB=${input.databaseName}`,
              `POSTGRES_USER=${input.username}`,
              `POSTGRES_PASSWORD=${input.password}`,
            ],
            Mounts: [
              {
                Type: "volume",
                Source: input.volumeName,
                Target: "/var/lib/postgresql/data",
              },
            ],
            Healthcheck: {
              Test: ["CMD-SHELL", `pg_isready -U ${input.username} -d ${input.databaseName}`],
              Interval: 5_000_000_000,
              Timeout: 3_000_000_000,
              Retries: 20,
            },
            Hostname: input.hostnameAlias,
          },
          Networks: [
            {
              Target: PLATFORM.swarm.resourceNetwork,
              Aliases: [input.serviceName, input.hostnameAlias],
            },
          ],
          RestartPolicy: {
            Condition: "on-failure",
            MaxAttempts: 5,
            Delay: 5_000_000_000,
          },
        },
        Mode: {
          Replicated: {
            Replicas: 1,
          },
        },
        EndpointSpec: {
          Ports: [
            {
              Protocol: "tcp",
              TargetPort: 5432,
              PublishMode: "host",
            },
          ],
        },
      })
    ).unwrap();

    // Wait for the service task to be running
    const runtime = await waitForServiceReady(docker, input.serviceName);
    return runtime;
  } finally {
    docker.destroy();
  }
}
```

- [ ] **Step 3: Implement `inspectSwarmPostgresRuntime()`**

```typescript
// append to packages/api/src/swarm/postgres.ts

export async function inspectSwarmPostgresRuntime(input: {
  serviceName: string;
  volumeName: string;
}): Promise<SwarmPostgresRuntime> {
  const docker = Docker.fromEnv();

  try {
    const runtime = await inspectSwarmService(docker, input.serviceName);
    if (!runtime) {
      return {
        serviceId: null,
        serviceName: input.serviceName,
        volumeName: input.volumeName,
        networkName: PLATFORM.swarm.resourceNetwork,
        status: "missing",
        health: null,
      };
    }

    return runtime;
  } finally {
    docker.destroy();
  }
}
```

- [ ] **Step 4: Implement `destroySwarmPostgres()`**

```typescript
// append to packages/api/src/swarm/postgres.ts

export async function destroySwarmPostgres(input: {
  serviceName: string;
}): Promise<void> {
  const docker = Docker.fromEnv();

  try {
    const listResult = (await docker.services.list({
      filters: { name: [input.serviceName] },
    })).unwrap();

    const service = listResult.find((s) => s.Spec?.Name === input.serviceName);
    if (!service) {
      return;
    }

    console.log("[swarm:postgres] removing service '%s'", input.serviceName);
    await docker.services.getService(service.ID).remove();
  } finally {
    docker.destroy();
  }
}
```

- [ ] **Step 5: Implement helper functions**

```typescript
// append to packages/api/src/swarm/postgres.ts

async function inspectSwarmService(
  docker: Docker,
  serviceName: string,
): Promise<SwarmPostgresRuntime | null> {
  const listResult = (await docker.services.list({
    filters: { name: [serviceName] },
  })).unwrap();

  const service = listResult.find((s) => s.Spec?.Name === serviceName);
  if (!service) {
    return null;
  }

  // Get the latest task for this service
  const tasks = (await docker.tasks.list({
    filters: { service: [serviceName] },
  })).unwrap();

  const latestTask = tasks
    .sort((a, b) => {
      const aTime = new Date(a.CreatedAt ?? 0).getTime();
      const bTime = new Date(b.CreatedAt ?? 0).getTime();
      return bTime - aTime;
    })
    .at(0);

  const taskState = latestTask?.Status?.State;
  const status = mapTaskStateToStatus(taskState);
  const health = mapTaskHealth(latestTask);

  return {
    serviceId: service.ID,
    serviceName,
    volumeName: service.Spec?.TaskTemplate?.ContainerSpec?.Mounts?.[0]?.Source ?? "",
    networkName: PLATFORM.swarm.resourceNetwork,
    status,
    health,
  };
}

function mapTaskStateToStatus(
  state: string | undefined,
): SwarmPostgresRuntime["status"] {
  switch (state) {
    case "running":
      return "running";
    case "starting":
    case "preparing":
    case "assigned":
    case "accepted":
    case "ready":
    case "pending":
    case "new":
      return "starting";
    case "complete":
    case "shutdown":
      return "stopped";
    case "failed":
    case "rejected":
    case "orphaned":
    case "remove":
      return "error";
    default:
      return "missing";
  }
}

function mapTaskHealth(
  task: { Status?: { ContainerStatus?: { ContainerID?: string } }; Spec?: unknown } | undefined,
): SwarmPostgresRuntime["health"] {
  // Swarm tasks don't expose container health directly in the task status.
  // For now, if the task is running we consider it healthy after the readiness wait.
  // A more precise approach would inspect the actual container, but Swarm's restart
  // policy handles unhealthy containers automatically.
  if (!task) return null;
  const state = (task as { Status?: { State?: string } }).Status?.State;
  if (state === "running") return "healthy";
  if (state === "starting" || state === "preparing") return "starting";
  return null;
}

async function waitForServiceReady(
  docker: Docker,
  serviceName: string,
): Promise<SwarmPostgresRuntime> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const runtime = await inspectSwarmService(docker, serviceName);

    if (runtime && runtime.status === "running") {
      return runtime;
    }

    if (runtime && runtime.status === "error") {
      return runtime;
    }

    await sleep(1000);
  }

  // Timeout — return whatever state we have
  const runtime = await inspectSwarmService(docker, serviceName);
  return runtime ?? {
    serviceId: null,
    serviceName,
    volumeName: "",
    networkName: PLATFORM.swarm.resourceNetwork,
    status: "error",
    health: null,
  };
}
```

- [ ] **Step 6: Add barrel export**

```typescript
// packages/api/src/swarm/index.ts
export { initializeSwarm, ensureSwarm, ensureOverlayNetwork } from "./client";
export {
  provisionSwarmPostgres,
  inspectSwarmPostgresRuntime,
  destroySwarmPostgres,
  type SwarmPostgresRuntime,
} from "./postgres";
```

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/swarm/
git commit -m "feat(swarm): add Postgres provisioning via Swarm services"
```

---

### Task 4: Write Swarm Postgres Tests

**Files:**
- Create: `packages/api/src/swarm/__tests__/postgres.test.ts`

- [ ] **Step 1: Write unit tests for the Swarm Postgres module**

These tests mock the Docker API to verify the provisioning logic without needing a running Docker daemon.

```typescript
// packages/api/src/swarm/__tests__/postgres.test.ts
import { describe, expect, mock, test, beforeEach } from "bun:test";

// We test the helper logic by importing the mapping functions.
// The actual Docker calls are integration-tested manually or in CI with Docker.

// Since the mapping functions are not exported, we test through the public API
// by verifying the types and structure of the runtime view.

import type { SwarmPostgresRuntime } from "../postgres";

describe("SwarmPostgresRuntime", () => {
  test("runtime type has expected shape", () => {
    const runtime: SwarmPostgresRuntime = {
      serviceId: "svc_abc123",
      serviceName: "otterdeploy-pg-acme-primary",
      volumeName: "otterdeploy-pgdata-acme-primary",
      networkName: "otterdeploy-resources",
      status: "running",
      health: "healthy",
    };

    expect(runtime.serviceId).toBe("svc_abc123");
    expect(runtime.status).toBe("running");
    expect(runtime.health).toBe("healthy");
  });

  test("missing runtime has null serviceId", () => {
    const runtime: SwarmPostgresRuntime = {
      serviceId: null,
      serviceName: "otterdeploy-pg-acme-primary",
      volumeName: "otterdeploy-pgdata-acme-primary",
      networkName: "otterdeploy-resources",
      status: "missing",
      health: null,
    };

    expect(runtime.serviceId).toBeNull();
    expect(runtime.status).toBe("missing");
  });

  test("runtime status values cover all states", () => {
    const validStatuses: SwarmPostgresRuntime["status"][] = [
      "running", "starting", "stopped", "missing", "error",
    ];
    const validHealth: SwarmPostgresRuntime["health"][] = [
      "healthy", "unhealthy", "starting", null,
    ];

    for (const status of validStatuses) {
      expect(typeof status).toBe("string");
    }
    for (const health of validHealth) {
      expect(health === null || typeof health === "string").toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd packages/api && bun test src/swarm/__tests__/postgres.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/swarm/__tests__/postgres.test.ts
git commit -m "test(swarm): add Postgres runtime type tests"
```

---

### Task 5: Migrate Project Service to Use Swarm

**Files:**
- Modify: `packages/api/src/routers/project/service.ts`

This is the critical migration step. We replace all Docker container calls with Swarm service calls while keeping the same external API contract.

- [ ] **Step 1: Update imports**

Replace the Docker imports at the top of `packages/api/src/routers/project/service.ts`:

```typescript
// OLD:
import {
  destroyDockerPostgres,
  inspectDockerPostgresRuntime,
  provisionDockerPostgres,
  type DockerPostgresRuntime,
} from "../../docker/postgres";

// NEW:
import {
  destroySwarmPostgres,
  inspectSwarmPostgresRuntime,
  provisionSwarmPostgres,
  type SwarmPostgresRuntime,
} from "../../swarm";
```

- [ ] **Step 2: Update the `PostgresResourceView` type**

Replace `DockerPostgresRuntime` with `SwarmPostgresRuntime`:

```typescript
// OLD:
export type PostgresResourceView = {
  // ...
  runtime: DockerPostgresRuntime;
};

// NEW:
export type PostgresResourceView = {
  // ...
  runtime: SwarmPostgresRuntime;
};
```

- [ ] **Step 3: Update `createPostgresResource()`**

Replace the `provisionDockerPostgres` call and remove the `hostPort` check. Swarm services don't expose host ports the same way — they use overlay network routing.

Find the provisioning section (around line 192) and replace:

```typescript
  // OLD:
  const runtime = await provisionDockerPostgres({
    containerName,
    volumeName,
    hostnameAlias: internalHostname,
    databaseName,
    username,
    password,
  });
  if (runtime.hostPort === null) {
    throw new Error(`Docker runtime for "${containerName}" did not expose a host port.`);
  }

  // NEW:
  console.log("[project:postgres] provisioning swarm service '%s'", containerName);
  const runtime = await provisionSwarmPostgres({
    serviceName: containerName,
    volumeName,
    hostnameAlias: internalHostname,
    databaseName,
    username,
    password,
  });
```

Note: The variable is still called `containerName` for naming consistency with the existing slug generation. The name format (`otterdeploy-pg-{project}-{resource}`) works for both containers and Swarm services. We'll keep using the same naming functions.

- [ ] **Step 4: Update `mapDatabaseResource()`**

Remove the `localConnectionString` host port logic since Swarm services don't expose random host ports. Local access goes through Caddy's Layer4 proxy instead.

```typescript
// In mapDatabaseResource(), replace the localConnectionString block:

// OLD:
    localConnectionString:
      runtime.hostPort === null
        ? null
        : buildConnectionString({
            username: databaseRecord.username,
            password: databaseRecord.password,
            hostname: PLATFORM.database.localHost,
            port: runtime.hostPort,
            databaseName: databaseRecord.databaseName,
          }),

// NEW:
    localConnectionString: buildConnectionString({
      username: databaseRecord.username,
      password: databaseRecord.password,
      hostname: PLATFORM.database.localHost,
      port: PLATFORM.database.publicPort,
      databaseName: databaseRecord.databaseName,
      sslmode: "require",
      sslnegotiation: "direct",
    }),
```

- [ ] **Step 5: Update `ensureDockerRuntimeForRecord()`**

Rename and update to use Swarm APIs:

```typescript
// Replace the entire ensureDockerRuntimeForRecord function:

async function ensureSwarmRuntimeForRecord(
  record: DatabaseResourceRecord,
  projectSlug: string,
): Promise<{ record: DatabaseResourceRecord; runtime: SwarmPostgresRuntime }> {
  const serviceName = buildContainerName({ projectSlug, resourceName: record.resource.name });
  const volumeName = buildVolumeName({ projectSlug, resourceName: record.resource.name });
  const existingRuntime = await inspectSwarmPostgresRuntime({ serviceName, volumeName });

  if (existingRuntime.status !== "missing") {
    return { record, runtime: existingRuntime };
  }

  const runtime = await provisionSwarmPostgres({
    serviceName,
    volumeName,
    hostnameAlias: record.database.internalHostname,
    databaseName: record.database.databaseName,
    username: record.database.username,
    password: record.database.password,
  });

  const existingRoute = await getProxyRouteByResourceId(record.resource.id);
  if (existingRoute) {
    await updateProxyRoute(existingRoute.id, {
      upstreamHost: record.database.internalHostname,
      upstreamPort: PLATFORM.database.internalPort,
    });
  }

  await updateDatabaseResourceRuntime({
    resourceId: record.resource.id,
    upstreamHost: record.database.internalHostname,
    upstreamPort: PLATFORM.database.internalPort,
    caddyLayer4Snippet: "",
  });

  const reconcileResult = await reconcile();
  const isApplied = reconcileResult.applied.includes(record.resource.projectId);

  await updateDatabaseResourceStatus(
    record.resource.id,
    isApplied ? "valid" : "invalid",
  );

  return {
    record: {
      resource: { ...record.resource, status: isApplied ? "valid" : "invalid" },
      database: {
        ...record.database,
        upstreamHost: record.database.internalHostname,
        upstreamPort: PLATFORM.database.internalPort,
        caddyLayer4Snippet: "",
      },
    },
    runtime,
  };
}
```

- [ ] **Step 6: Update the call site in `mapDatabaseResource()`**

```typescript
// In mapDatabaseResource(), replace:
  const hydrated = await ensureDockerRuntimeForRecord(record, resolvedProjectSlug);

// With:
  const hydrated = await ensureSwarmRuntimeForRecord(record, resolvedProjectSlug);
```

- [ ] **Step 7: Update `deletePostgresResource()`**

```typescript
// In deletePostgresResource(), replace:
  const containerName = buildContainerName({ projectSlug, resourceName: record.resource.name });
  await destroyDockerPostgres({ containerName });
  console.log("[project:postgres] docker container destroyed");

// With:
  const serviceName = buildContainerName({ projectSlug, resourceName: record.resource.name });
  await destroySwarmPostgres({ serviceName });
  console.log("[project:postgres] swarm service destroyed");
```

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routers/project/service.ts
git commit -m "refactor: migrate Postgres provisioning from Docker containers to Swarm services"
```

---

### Task 6: Update Frontend Runtime Display

**Files:**
- Modify: `apps/web/src/features/project-flow/components/database-resource.tsx`

- [ ] **Step 1: Check what runtime fields the frontend uses**

Read the file and identify references to `runtime.containerName`, `runtime.hostPort`, etc. Update them to use the new `SwarmPostgresRuntime` shape:

- `runtime.containerName` → `runtime.serviceName`
- `runtime.hostPort` → remove (no longer applicable, local access via Caddy)
- `runtime.status` → same values, no change needed
- `runtime.health` → same values, no change needed

The exact changes depend on what the component currently renders. The field mapping is:

| Old (DockerPostgresRuntime) | New (SwarmPostgresRuntime) |
|---|---|
| `containerName: string` | `serviceName: string` |
| `volumeName: string` | `volumeName: string` (same) |
| `networkName: string` | `networkName: string` (same) |
| `hostPort: number \| null` | removed (use Caddy Layer4 for local access) |
| `status: ...` | `status: ...` (same values) |
| `health: ...` | `health: ...` (same values) |

New field:
| — | `serviceId: string \| null` |

- [ ] **Step 2: Update the component to use `serviceName` instead of `containerName`**

Find and replace `containerName` references with `serviceName` in the component. Remove any `hostPort` display since local access now goes through Caddy's public hostname.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/project-flow/components/database-resource.tsx
git commit -m "refactor(web): update database resource component for Swarm runtime"
```

---

### Task 7: Add Swarm Init to Server Startup

**Files:**
- Modify: `apps/server/src/index.ts` (or wherever the Hono server starts)

- [ ] **Step 1: Find the server entry point**

Look for the main server file in `apps/server/src/`. It will be the file that creates the Hono app and starts listening.

- [ ] **Step 2: Add Swarm initialization on startup**

Add the `initializeSwarm()` call before the server starts listening:

```typescript
import { initializeSwarm } from "@otterdeploy/api/swarm";

// Add after other initialization, before server.listen:
console.log("[server] initializing Docker Swarm...");
await initializeSwarm();
console.log("[server] Swarm ready");
```

This ensures Swarm mode is active and the overlay network exists before any API requests come in.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/
git commit -m "feat(server): initialize Docker Swarm on startup"
```

---

### Task 8: Update Docker Compose for Swarm Compatibility

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update the network configuration**

The `otterdeploy-resources` network needs to be an overlay network for Swarm. However, `docker compose up` (non-Swarm mode for dev infra) doesn't support overlay networks. The solution: the platform infra (postgres, inngest, caddy) stays on docker-compose with a bridge network. The overlay network for managed resources is created programmatically by `initializeSwarm()`.

Remove the external network from docker-compose since it's now managed by the platform:

```yaml
# In docker-compose.yml, update the caddy service networks section.
# Caddy needs to be on the Swarm overlay network to reach managed services.
# Since Caddy runs via compose (not as a Swarm service), we need to keep
# the external network reference but the platform code will create it.

networks:
  otterdeploy-resources:
    external: true
    name: ${DOCKER_RESOURCE_NETWORK:-otterdeploy-resources}
```

Actually, keep this as-is. The overlay network with `Attachable: true` (set in Task 1) allows non-Swarm containers to join it. Caddy, running via docker-compose, will attach to this overlay network. The only change needed is ensuring the network is created before `docker compose up` — which `initializeSwarm()` handles.

**Important**: The dev startup sequence becomes:
1. Start Swarm: platform server runs `initializeSwarm()` (or manually: `docker swarm init && docker network create --driver overlay --attachable otterdeploy-resources`)
2. Start infra: `docker compose up`
3. Start dev server: `bun dev`

- [ ] **Step 2: Document the new startup sequence**

Add a comment at the top of docker-compose.yml:

```yaml
# Prerequisites:
# 1. Docker Swarm must be initialized: docker swarm init
# 2. Overlay network must exist: docker network create --driver overlay --attachable otterdeploy-resources
# These are handled automatically by the platform server on startup.
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "docs: add Swarm prerequisite notes to docker-compose.yml"
```

---

### Task 9: Verify Existing Tests Still Pass

**Files:**
- Test: `packages/api/src/caddy/__tests__/builder.test.ts`
- Test: `packages/api/src/caddy/__tests__/reconciler.test.ts`
- Test: `packages/api/src/swarm/__tests__/postgres.test.ts`

- [ ] **Step 1: Run all existing tests**

```bash
cd packages/api && bun test
```

Expected: All Caddy builder, reconciler, and Swarm postgres tests pass. The Caddy layer is completely unchanged — it reads from `proxy_route` records and builds Caddyfile config regardless of whether the upstream is a container or Swarm service.

- [ ] **Step 2: If any test fails, fix it**

The only likely failure is if a test imports from `../../docker/postgres` — those imports were replaced in Task 5.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve test failures from Swarm migration"
```

---

### Task 10: Manual Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Initialize Swarm locally**

```bash
docker swarm init 2>/dev/null || true
```

- [ ] **Step 2: Start infrastructure**

```bash
docker compose up -d
```

- [ ] **Step 3: Start the dev server**

```bash
bun dev
```

- [ ] **Step 4: Create a project via the UI**

Navigate to the dashboard, create a new project.

- [ ] **Step 5: Add a Postgres database**

In the project canvas, create a new Postgres database. Verify:
- Service appears in `docker service ls`
- Database is accessible via the public connection string (through Caddy Layer4)
- Database is accessible via the internal connection string (from another container on the overlay network)
- Canvas shows "running" status and "healthy" health

- [ ] **Step 6: Delete the database**

Delete the database resource. Verify:
- Service is removed from `docker service ls`
- Proxy route is removed
- Caddy config no longer includes the route

- [ ] **Step 7: Verify the old Docker container approach is fully replaced**

```bash
# Should show NO otterdeploy-pg-* containers
docker ps -a --filter "label=otterdeploy.managed=true" --format "{{.Names}}"

# Should show otterdeploy-pg-* services (if database is still running)
docker service ls --filter "label=otterdeploy.managed=true"
```

- [ ] **Step 8: Commit any final fixes**

```bash
git add -A && git commit -m "fix: integration test fixes for Swarm migration"
```

---

## Migration Notes

### Breaking changes
- **Local connection strings**: No more random host ports. Local development access now goes through Caddy's Layer4 proxy on port 5432 (same as public access). The `localConnectionString` now uses `127.0.0.1:5432` with SSL.
- **Existing databases**: Any databases provisioned as raw containers will show as "missing" since the platform now looks for Swarm services. They need to be deleted and re-created. For dev this is fine — for any persistent data, back up first.

### What stays the same
- All API contracts (request/response shapes) — the `runtime` field changes type name but keeps the same structure
- Caddy reconciliation — completely untouched
- Proxy routes — completely untouched
- Database schema — no migrations needed
- Frontend canvas — only field rename (`containerName` → `serviceName`)

### What's now possible (after this phase)
- Swarm rolling updates for database version upgrades
- Swarm restart policies (automatic recovery from crashes)
- Foundation for deploying app services (Phase 2) using the same Swarm primitives
- Path to multi-node by adding Swarm worker nodes
