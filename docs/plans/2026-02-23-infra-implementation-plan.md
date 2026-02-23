# OtterStack Infrastructure Implementation Plan (P0 Foundation)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the minimum infrastructure to deploy a user's app from GitHub push to live URL with automatic SSL.

**Architecture:** Inngest-driven deployment pipeline: GitHub webhook triggers clone → Nixpacks build → Docker Swarm service → Caddy reverse proxy with auto-HTTPS. All container operations via Dockerode, all proxy config via Caddy Admin API.

**Tech Stack:** Dockerode, Nixpacks, Caddy Admin API, Inngest step functions, Drizzle ORM, oRPC, Vitest, Pino, better-result

**Design Doc:** `docs/plans/2026-02-23-infra-implementation-design.md`

**Scope:** P0 Foundation only — Sections 1, 2, 3, 4, 5, 6, 7, 8, 11, 15, 16-P0 from the design doc. P1 Operations (monitoring, backups, notifications, audit, API completion) is a separate plan.

---

## Dependency Order

```
Task 1:  Testing infrastructure (vitest setup)
Task 2:  Database schema additions (Section 15)
Task 3:  Docker package — client + Swarm init (Section 1.1-1.2)
Task 4:  Docker package — service CRUD (Section 1.3)
Task 5:  Docker package — image, network, volume management (Section 1.4-1.6b)
Task 6:  Docker package — stats, cleanup (Section 1.7-1.8)
Task 7:  Builder package — dispatcher + Nixpacks adapter (Section 2.1-2.2)
Task 8:  Builder package — Dockerfile + Docker Image adapters (Section 2.3-2.4)
Task 9:  Builder package — Static site + build context (Section 2.5, 2.7-2.9)
Task 10: Git package — provider abstraction + GitHub adapter (Section 3.0-3.1)
Task 11: Git package — webhook receiver + parser (Section 3.2-3.3)
Task 12: Git package — cloner + auto-deploy (Section 3.4-3.8)
Task 13: Secrets package — env var resolution + encryption (Section 7.1-7.6)
Task 14: Secrets package — inter-resource refs + snapshots (Section 7.7-7.8)
Task 15: Proxy package — Caddy client + config builder (Section 5.1-5.3)
Task 16: Proxy package — container lifecycle + sync (Section 5.5-5.9)
Task 17: Deployment pipeline — validate + clone + secrets steps (Section 4.1-4.4)
Task 18: Deployment pipeline — build + deploy + health steps (Section 4.5-4.8)
Task 19: Deployment pipeline — route + verify + cleanup steps (Section 4.9-4.11)
Task 20: Deployment pipeline — failure, cancel, rollback, queue (Section 4.12-4.15)
Task 21: Database provisioning — provisioner + flow (Section 6.1-6.3)
Task 22: Database provisioning — external ports + config + versions (Section 6.4-6.7)
Task 23: Custom domains — CRUD + DNS verification (Section 8.1-8.3)
Task 24: Custom domains — SSL + redirects (Section 8.4-8.8)
Task 25: Server bootstrap — setup wizard + health (Section 11.1-11.8)
Task 26: Hardening gates — P0 security + reliability (Section 16.1-16.3)
```

---

## Task 1: Set Up Testing Infrastructure

**Files:**
- Create: `packages/config/vitest.base.ts`
- Modify: `package.json` (root)
- Create: `packages/docker/vitest.config.ts` (template for all packages)

**Step 1: Install vitest**

Run: `bun add -d vitest @vitest/coverage-v8 -w`
Expected: packages added to root devDependencies

**Step 2: Create shared vitest base config**

```typescript
// packages/config/vitest.base.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    testTimeout: 10_000,
  },
});
```

**Step 3: Add test script to root package.json**

Add to root `package.json` scripts:
```json
"test": "turbo run test",
"test:unit": "turbo run test:unit"
```

**Step 4: Verify vitest runs**

Run: `bunx vitest --version`
Expected: version number printed

**Step 5: Commit**

```bash
git add packages/config/vitest.base.ts package.json bun.lock
git commit -m "chore: add vitest testing infrastructure"
```

---

## Task 2: Database Schema Additions

**Files:**
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/architecture.ts`
- Modify: `packages/db/src/schema/infrastructure.ts`
- Modify: `packages/db/src/schema/operations.ts`
- Create: `packages/db/src/schema/metrics.ts`
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Add new enum values**

In `packages/db/src/schema/enums.ts`, add:
```typescript
// Add to buildMethodEnum
export const buildMethodEnum = pgEnum("build_method", [
  "nixpacks", "dockerfile", "buildpack", "docker_image", "static", "compose"
]);

// Add new enum
export const caddyStatusEnum = pgEnum("caddy_status", [
  "not_installed", "initializing", "running", "stopped", "error"
]);

// Add to deploymentSourceEnum (or create if not exists)
// Ensure "preview" and "config_change" are included
```

**Step 2: Add column additions to existing tables**

In `packages/db/src/schema/architecture.ts`:
```typescript
// Add to projectResource table
cronCommand: text("cron_command"),
registryId: text("registry_id"),
composeFile: text("compose_file"),

// Add to project table
baseDomain: text("base_domain"),
```

In `packages/db/src/schema/infrastructure.ts`:
```typescript
// Add to server table
swarmNodeId: text("swarm_node_id"),
baseDomain: text("base_domain"),
acmeEmail: text("acme_email"),
dockerCleanupThreshold: integer("docker_cleanup_threshold").default(80),

// Add to gitRepository table
watchPaths: text("watch_paths").array(),
```

In `packages/db/src/schema/operations.ts`:
```typescript
// Add to customDomain table
redirectRules: jsonb("redirect_rules"),

// Add to notificationChannel table
eventFilter: jsonb("event_filter"),
```

**Step 3: Create new metrics schema file**

Create `packages/db/src/schema/metrics.ts` with tables:
- `resourceMetric` — time-series container stats
- `resourceMetricHourly` — rollup aggregates
- `webhookDelivery` — replay protection
- `containerRegistry` — Docker registry credentials
- `configFile` — file mounts
- `scheduledTaskExecution` — cron job history
- `caddyInstance` — Caddy status tracking
- `backupSchedule` — backup config per resource

**Step 4: Export new schema from index**

Add to `packages/db/src/schema/index.ts`:
```typescript
export * from "./metrics";
```

**Step 5: Generate migration**

Run: `bun run db:generate`
Expected: migration file created in drizzle folder

**Step 6: Run migration**

Run: `bun run db:migrate`
Expected: migration applied successfully

**Step 7: Commit**

```bash
git add packages/db/
git commit -m "feat: add P0 infrastructure schema additions"
```

---

## Task 3: Docker Package — Client + Swarm Init

**Files:**
- Create: `packages/docker/package.json`
- Create: `packages/docker/tsconfig.json`
- Create: `packages/docker/src/index.ts`
- Create: `packages/docker/src/client.ts`
- Create: `packages/docker/src/swarm.ts`
- Create: `packages/docker/src/types.ts`
- Create: `packages/docker/src/__tests__/swarm.test.ts`
- Create: `packages/docker/vitest.config.ts`

**Step 1: Create package scaffolding**

`packages/docker/package.json`:
```json
{
  "name": "@otterdeploy/docker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "dockerode": "^4.0.0",
    "@otterdeploy/logger": "workspace:*",
    "better-result": "^1.0.0"
  },
  "devDependencies": {
    "@otterdeploy/config": "workspace:*",
    "@types/dockerode": "^3.3.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create Docker client singleton**

`packages/docker/src/client.ts`:
```typescript
import Docker from "dockerode";

let instance: Docker | null = null;

export function getDockerClient(): Docker {
  if (!instance) {
    instance = new Docker({ socketPath: "/var/run/docker.sock" });
  }
  return instance;
}

// For testing: allow injecting a mock
export function setDockerClient(client: Docker): void {
  instance = client;
}

export function resetDockerClient(): void {
  instance = null;
}
```

**Step 3: Create shared types**

`packages/docker/src/types.ts`:
```typescript
export interface OtterStackLabels {
  "otterstack.resource.id": string;
  "otterstack.project.id": string;
  "otterstack.environment.id": string;
  "otterstack.organization.id": string;
}

export interface SwarmInitResult {
  nodeId: string;
  alreadyActive: boolean;
}

export interface NetworkCreateResult {
  networkId: string;
  alreadyExists: boolean;
}
```

**Step 4: Implement Swarm initialization**

`packages/docker/src/swarm.ts`:
```typescript
import { Result, ok, err } from "better-result";
import { getDockerClient } from "./client";
import type { SwarmInitResult, NetworkCreateResult } from "./types";

export async function initSwarm(): Promise<Result<SwarmInitResult, Error>> {
  const docker = getDockerClient();
  try {
    const info = await docker.info();
    if (info.Swarm?.LocalNodeState === "active") {
      return ok({ nodeId: info.Swarm.NodeID, alreadyActive: true });
    }
    await docker.swarmInit({
      ListenAddr: "127.0.0.1:2377",
      AdvertiseAddr: "127.0.0.1:2377",
    });
    const updatedInfo = await docker.info();
    return ok({ nodeId: updatedInfo.Swarm.NodeID, alreadyActive: false });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function isSwarmActive(): Promise<boolean> {
  const docker = getDockerClient();
  try {
    const info = await docker.info();
    return info.Swarm?.LocalNodeState === "active";
  } catch {
    return false;
  }
}

export async function createIngressNetwork(): Promise<Result<NetworkCreateResult, Error>> {
  const docker = getDockerClient();
  const networkName = "otterstack-ingress";
  try {
    const networks = await docker.listNetworks({
      filters: { name: [networkName] },
    });
    if (networks.some((n) => n.Name === networkName)) {
      return ok({ networkId: networks[0].Id, alreadyExists: true });
    }
    const network = await docker.createNetwork({
      Name: networkName,
      Driver: "overlay",
      Attachable: true,
      Labels: { "otterstack.managed": "true", "otterstack.role": "ingress" },
    });
    return ok({ networkId: network.id, alreadyExists: false });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

**Step 5: Create barrel export**

`packages/docker/src/index.ts`:
```typescript
export { getDockerClient, setDockerClient, resetDockerClient } from "./client";
export { initSwarm, isSwarmActive, createIngressNetwork } from "./swarm";
export type { OtterStackLabels, SwarmInitResult, NetworkCreateResult } from "./types";
```

**Step 6: Install dependencies**

Run: `bun install`
Expected: dockerode installed, workspace linked

**Step 7: Write unit test for swarm module**

`packages/docker/src/__tests__/swarm.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import { initSwarm, isSwarmActive, createIngressNetwork } from "../swarm";

function createMockDocker(overrides: Record<string, any> = {}) {
  return {
    info: vi.fn().mockResolvedValue({
      Swarm: { LocalNodeState: "inactive", NodeID: "" },
      ...overrides.info,
    }),
    swarmInit: vi.fn().mockResolvedValue(undefined),
    listNetworks: vi.fn().mockResolvedValue([]),
    createNetwork: vi.fn().mockResolvedValue({ id: "net-123" }),
    ...overrides,
  } as any;
}

describe("swarm", () => {
  beforeEach(() => resetDockerClient());

  it("initializes swarm when inactive", async () => {
    const mock = createMockDocker();
    mock.info
      .mockResolvedValueOnce({ Swarm: { LocalNodeState: "inactive" } })
      .mockResolvedValueOnce({ Swarm: { LocalNodeState: "active", NodeID: "node-1" } });
    setDockerClient(mock);

    const result = await initSwarm();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodeId).toBe("node-1");
      expect(result.value.alreadyActive).toBe(false);
    }
    expect(mock.swarmInit).toHaveBeenCalledWith(
      expect.objectContaining({ ListenAddr: "127.0.0.1:2377" })
    );
  });

  it("skips init when swarm already active", async () => {
    const mock = createMockDocker();
    mock.info.mockResolvedValue({ Swarm: { LocalNodeState: "active", NodeID: "node-1" } });
    setDockerClient(mock);

    const result = await initSwarm();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alreadyActive).toBe(true);
    }
    expect(mock.swarmInit).not.toHaveBeenCalled();
  });

  it("creates ingress network when not exists", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await createIngressNetwork();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alreadyExists).toBe(false);
    }
    expect(mock.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Name: "otterstack-ingress", Driver: "overlay" })
    );
  });
});
```

**Step 8: Create vitest config**

`packages/docker/vitest.config.ts`:
```typescript
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@otterdeploy/config/vitest.base";

export default mergeConfig(baseConfig, defineConfig({}));
```

**Step 9: Run tests**

Run: `cd packages/docker && bun run test`
Expected: 3 tests pass

**Step 10: Commit**

```bash
git add packages/docker/
git commit -m "feat: add docker package with client, swarm init, ingress network"
```

---

## Task 4: Docker Package — Service CRUD

**Files:**
- Create: `packages/docker/src/service.ts`
- Create: `packages/docker/src/__tests__/service.test.ts`
- Modify: `packages/docker/src/index.ts`

**Step 1: Write failing tests for service CRUD**

`packages/docker/src/__tests__/service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  createService, updateService, removeService,
  inspectService, listServices, getServiceLogs, scaleService,
} from "../service";

// ... mock setup similar to Task 3

describe("service CRUD", () => {
  it("creates a Swarm service with correct spec", async () => { /* ... */ });
  it("updates a service with start-first order", async () => { /* ... */ });
  it("removes a service by name", async () => { /* ... */ });
  it("inspects a service", async () => { /* ... */ });
  it("lists services by label filter", async () => { /* ... */ });
  it("scales a service to N replicas", async () => { /* ... */ });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/docker && bun run test`
Expected: FAIL — service module not found

**Step 3: Implement service CRUD**

`packages/docker/src/service.ts`:
```typescript
import { Result, ok, err } from "better-result";
import { getDockerClient } from "./client";
import type { OtterStackLabels } from "./types";

export interface CreateServiceOpts {
  name: string;
  image: string;
  env?: string[];
  ports?: Array<{ target: number; published: number }>;
  volumes?: Array<{ source: string; target: string }>;
  networks?: string[];
  labels: OtterStackLabels;
  healthCheck?: { cmd: string; interval: number; timeout: number; retries: number };
  restartPolicy?: "always" | "on-failure" | "none";
  resourceLimits?: { cpuLimit?: number; memoryLimit?: number };
  replicas?: number;
}

export async function createService(opts: CreateServiceOpts): Promise<Result<string, Error>> {
  const docker = getDockerClient();
  try {
    const service = await docker.createService({
      Name: opts.name,
      Labels: opts.labels as unknown as Record<string, string>,
      TaskTemplate: {
        ContainerSpec: {
          Image: opts.image,
          Env: opts.env,
          Mounts: opts.volumes?.map((v) => ({
            Type: "volume" as const,
            Source: v.source,
            Target: v.target,
          })),
          HealthCheck: opts.healthCheck ? {
            Test: ["CMD-SHELL", opts.healthCheck.cmd],
            Interval: opts.healthCheck.interval * 1e9,
            Timeout: opts.healthCheck.timeout * 1e9,
            Retries: opts.healthCheck.retries,
          } : undefined,
        },
        RestartPolicy: {
          Condition: opts.restartPolicy === "none" ? "none"
            : opts.restartPolicy === "on-failure" ? "on-failure" : "any",
        },
        Networks: opts.networks?.map((n) => ({ Target: n })),
        Resources: opts.resourceLimits ? {
          Limits: {
            NanoCPUs: opts.resourceLimits.cpuLimit ? opts.resourceLimits.cpuLimit * 1e9 : undefined,
            MemoryBytes: opts.resourceLimits.memoryLimit ? opts.resourceLimits.memoryLimit * 1024 * 1024 : undefined,
          },
        } : undefined,
      },
      Mode: { Replicated: { Replicas: opts.replicas ?? 1 } },
      EndpointSpec: opts.ports ? {
        Ports: opts.ports.map((p) => ({
          TargetPort: p.target,
          PublishedPort: p.published,
          Protocol: "tcp" as const,
        })),
      } : undefined,
      UpdateConfig: {
        Parallelism: 1,
        Order: "start-first",
        FailureAction: "rollback",
        Monitor: 30_000_000_000,
        MaxFailureRatio: 0,
      },
      RollbackConfig: {
        Parallelism: 1,
        Order: "stop-first",
        FailureAction: "pause",
        Monitor: 15_000_000_000,
        MaxFailureRatio: 0,
      },
    });
    return ok(service.id);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function updateService(
  name: string,
  opts: Partial<CreateServiceOpts>,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();
  try {
    const service = docker.getService(name);
    const inspection = await service.inspect();
    const spec = { ...inspection.Spec };
    if (opts.image) spec.TaskTemplate.ContainerSpec.Image = opts.image;
    if (opts.env) spec.TaskTemplate.ContainerSpec.Env = opts.env;
    await service.update({ ...spec, version: inspection.Version.Index });
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function removeService(name: string): Promise<Result<void, Error>> {
  const docker = getDockerClient();
  try {
    const service = docker.getService(name);
    await service.remove();
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function inspectService(name: string): Promise<Result<any, Error>> {
  const docker = getDockerClient();
  try {
    const service = docker.getService(name);
    const info = await service.inspect();
    return ok(info);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function listServices(
  labelFilters?: Record<string, string>,
): Promise<Result<any[], Error>> {
  const docker = getDockerClient();
  try {
    const filters: Record<string, string[]> = {};
    if (labelFilters) {
      filters.label = Object.entries(labelFilters).map(([k, v]) => `${k}=${v}`);
    }
    const services = await docker.listServices({ filters });
    return ok(services);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function getServiceLogs(
  name: string,
  opts?: { tail?: number; since?: number; follow?: boolean },
): Promise<Result<NodeJS.ReadableStream, Error>> {
  const docker = getDockerClient();
  try {
    const service = docker.getService(name);
    const logs = await service.logs({
      stdout: true,
      stderr: true,
      tail: opts?.tail ?? 100,
      since: opts?.since,
      follow: opts?.follow ?? false,
    });
    return ok(logs as unknown as NodeJS.ReadableStream);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function scaleService(
  name: string,
  replicas: number,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();
  try {
    const service = docker.getService(name);
    const inspection = await service.inspect();
    const spec = { ...inspection.Spec };
    spec.Mode = { Replicated: { Replicas: replicas } };
    await service.update({ ...spec, version: inspection.Version.Index });
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
```

**Step 4: Update barrel export**

Add to `packages/docker/src/index.ts`:
```typescript
export {
  createService, updateService, removeService,
  inspectService, listServices, getServiceLogs, scaleService,
} from "./service";
export type { CreateServiceOpts } from "./service";
```

**Step 5: Run tests**

Run: `cd packages/docker && bun run test`
Expected: all tests pass

**Step 6: Commit**

```bash
git add packages/docker/src/service.ts packages/docker/src/__tests__/service.test.ts packages/docker/src/index.ts
git commit -m "feat: add Docker Swarm service CRUD with start-first blue-green"
```

---

## Task 5: Docker Package — Image, Network, Volume Management

**Files:**
- Create: `packages/docker/src/image.ts`
- Create: `packages/docker/src/network.ts`
- Create: `packages/docker/src/volume.ts`
- Create: `packages/docker/src/config.ts`
- Modify: `packages/docker/src/index.ts`

**Step 1: Implement image management**

`packages/docker/src/image.ts` — `pullImage`, `tagImage`, `removeImage`, `pruneImages`, `listImages`

**Step 2: Implement network management**

`packages/docker/src/network.ts` — `createProjectNetwork` (overlay + encrypted, connects Caddy), `removeProjectNetwork`, `connectService`, `disconnectService`

Network naming: `otterstack-proj-{projectId}`

**Step 3: Implement volume management**

`packages/docker/src/volume.ts` — `createVolume`, `removeVolume`, `inspectVolume`, `listVolumes`

Volume naming: `otterstack-{resourceId}-data`

**Step 4: Implement Docker config management**

`packages/docker/src/config.ts` — `createConfig`, `updateConfig`, `removeConfig`, `listConfigs`

For file mounts (Section 1.6b).

**Step 5: Update barrel export**

**Step 6: Write tests for each module**

**Step 7: Run tests**

Run: `cd packages/docker && bun run test`
Expected: all pass

**Step 8: Commit**

```bash
git add packages/docker/
git commit -m "feat: add image, network, volume, config management to docker package"
```

---

## Task 6: Docker Package — Stats + Cleanup

**Files:**
- Create: `packages/docker/src/stats.ts`
- Create: `packages/docker/src/cleanup.ts`
- Modify: `packages/docker/src/index.ts`

**Step 1: Implement container stats collection**

`packages/docker/src/stats.ts` — `listContainers`, `getContainerStats`, `execInContainer`

**Step 2: Implement cleanup functions**

`packages/docker/src/cleanup.ts` — `lightCleanup` (prune dangling images + stopped containers), `aggressiveCleanup` (prune unused images + volumes + build cache), `getDiskUsage`

**Step 3: Write tests**

**Step 4: Run tests and commit**

```bash
git add packages/docker/
git commit -m "feat: add container stats and threshold-based cleanup to docker package"
```

---

## Task 7: Builder Package — Dispatcher + Nixpacks

**Files:**
- Create: `packages/builder/package.json`
- Create: `packages/builder/tsconfig.json`
- Create: `packages/builder/src/index.ts`
- Create: `packages/builder/src/types.ts`
- Create: `packages/builder/src/dispatcher.ts`
- Create: `packages/builder/src/adapters/nixpacks.ts`
- Create: `packages/builder/vitest.config.ts`

**Step 1: Create package scaffolding**

`packages/builder/package.json` with deps: `@otterdeploy/docker`, `@otterdeploy/logger`, `better-result`, `execa`

**Step 2: Define builder interface**

`packages/builder/src/types.ts`:
```typescript
import { Result } from "better-result";

export interface BuildInput {
  sourceDir: string;
  resourceId: string;
  deploymentNumber: number;
  env: Record<string, string>;
  buildArgs?: Record<string, string>;
  buildCommand?: string;
  startCommand?: string;
  dockerfilePath?: string;
  rootDirectory?: string;
  force?: boolean;
}

export interface BuildOutput {
  imageName: string;
  imageTag: string;
  durationMs: number;
  logs: string[];
}

export type BuildMethod = "nixpacks" | "dockerfile" | "docker_image" | "static" | "compose";

export interface Builder {
  build(input: BuildInput): Promise<Result<BuildOutput, Error>>;
}
```

**Step 3: Implement build dispatcher**

`packages/builder/src/dispatcher.ts`:
```typescript
import type { BuildMethod, Builder } from "./types";
import { NixpacksBuilder } from "./adapters/nixpacks";

const builders: Record<string, () => Builder> = {
  nixpacks: () => new NixpacksBuilder(),
  // dockerfile, docker_image, static, compose added in subsequent tasks
};

export function getBuilder(method: BuildMethod): Builder {
  const factory = builders[method];
  if (!factory) throw new Error(`Unknown build method: ${method}`);
  return factory();
}
```

**Step 4: Implement Nixpacks adapter**

`packages/builder/src/adapters/nixpacks.ts`:
```typescript
import { Result, ok, err } from "better-result";
import { execaCommand } from "execa";
import type { Builder, BuildInput, BuildOutput } from "../types";

export class NixpacksBuilder implements Builder {
  async build(input: BuildInput): Promise<Result<BuildOutput, Error>> {
    const imageName = `otterstack-${input.resourceId}`;
    const tag = `v${input.deploymentNumber}`;
    const start = Date.now();
    const logs: string[] = [];

    try {
      const envFlags = Object.entries(input.env)
        .map(([k, v]) => `--env ${k}=${v}`)
        .join(" ");

      const cacheFlag = input.force ? "--no-cache" : "";
      const buildCmd = input.buildCommand ? `--build-cmd "${input.buildCommand}"` : "";
      const startCmd = input.startCommand ? `--start-cmd "${input.startCommand}"` : "";

      const cmd = [
        "nixpacks build",
        input.sourceDir,
        `--name ${imageName}:${tag}`,
        envFlags,
        cacheFlag,
        buildCmd,
        startCmd,
      ].filter(Boolean).join(" ");

      const result = await execaCommand(cmd, { shell: true });
      if (result.stdout) logs.push(result.stdout);
      if (result.stderr) logs.push(result.stderr);

      // Also tag as latest
      await execaCommand(`docker tag ${imageName}:${tag} ${imageName}:latest`);

      return ok({
        imageName,
        imageTag: tag,
        durationMs: Date.now() - start,
        logs,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
```

**Step 5: Create barrel export**

**Step 6: Write tests with mocked execa**

**Step 7: Run tests and commit**

```bash
git add packages/builder/
git commit -m "feat: add builder package with Nixpacks adapter"
```

---

## Task 8: Builder Package — Dockerfile + Docker Image Adapters

**Files:**
- Create: `packages/builder/src/adapters/dockerfile.ts`
- Create: `packages/builder/src/adapters/docker-image.ts`
- Modify: `packages/builder/src/dispatcher.ts`

**Step 1: Implement Dockerfile adapter**

Uses `docker build -f <path> -t <name>:<tag> <context>` with build args support.

**Step 2: Implement Docker Image adapter (pull-only)**

Uses `docker pull <registry>/<image>:<tag>` — no build step.

**Step 3: Register in dispatcher**

**Step 4: Write tests and commit**

```bash
git add packages/builder/
git commit -m "feat: add Dockerfile and Docker Image build adapters"
```

---

## Task 9: Builder Package — Static Site + Build Context

**Files:**
- Create: `packages/builder/src/adapters/static.ts`
- Create: `packages/builder/src/context.ts`
- Create: `packages/builder/src/tagging.ts`

**Step 1: Implement static site adapter**

Generates Caddyfile + Dockerfile, builds with `docker build`:
```dockerfile
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY . /srv
```

**Step 2: Implement build context preparation**

`packages/builder/src/context.ts` — `prepareBuildContext(sourceDir, rootDirectory)`: applies root directory filter, injects default `.dockerignore`, returns effective source path.

**Step 3: Implement image tagging strategy**

`packages/builder/src/tagging.ts` — `tagImage(resourceId, deploymentNumber)`, `pruneOldTags(resourceId, keep)` (retain last 10).

**Step 4: Write tests and commit**

```bash
git add packages/builder/
git commit -m "feat: add static site adapter, build context, image tagging"
```

---

## Task 10: Git Package — Provider Abstraction + GitHub Adapter

**Files:**
- Create: `packages/git/package.json`
- Create: `packages/git/tsconfig.json`
- Create: `packages/git/src/index.ts`
- Create: `packages/git/src/types.ts`
- Create: `packages/git/src/adapters/github.ts`
- Create: `packages/git/vitest.config.ts`

**Step 1: Create package scaffolding**

Deps: `@octokit/rest`, `@octokit/auth-app`, `better-result`, `execa`, `@otterdeploy/logger`

**Step 2: Define GitProviderAdapter interface**

`packages/git/src/types.ts`:
```typescript
export interface GitProviderAdapter {
  clone(repo: GitRepository, targetDir: string, opts?: CloneOpts): Promise<Result<string, GitCloneError>>;
  getAccessToken(provider: GitProvider): Promise<Result<string, GitAuthError>>;
  parseWebhook(headers: Headers, body: unknown): Result<WebhookEvent, WebhookParseError>;
  validateWebhookSignature(headers: Headers, body: string, secret: string): boolean;
  listRepositories(provider: GitProvider): Promise<Result<Repository[], GitApiError>>;
}

export interface WebhookEvent {
  type: "push" | "pull_request" | "installation";
  repository: { owner: string; name: string; fullName: string };
  branch: string;
  commitSha: string;
  commitMessage: string;
  changedFiles: string[];
  pusher: { name: string; email: string };
  deliveryId: string;
  prNumber?: number;
}
```

**Step 3: Implement GitHub adapter**

`packages/git/src/adapters/github.ts` — install token generation via `@octokit/auth-app`, clone via HTTPS with token auth, webhook parsing, signature validation (HMAC-SHA256).

**Step 4: Write tests and commit**

```bash
git add packages/git/
git commit -m "feat: add git package with GitHub adapter and provider abstraction"
```

---

## Task 11: Git Package — Webhook Receiver + Parser

**Files:**
- Create: `packages/git/src/webhook.ts`
- Create: `packages/git/src/__tests__/webhook.test.ts`
- Modify: `apps/server/src/index.ts` (or routes)

**Step 1: Implement webhook handler function**

`packages/git/src/webhook.ts`:
- Validate `X-Hub-Signature-256` (HMAC-SHA256)
- Check `X-GitHub-Delivery` against `webhookDelivery` table (replay protection)
- Parse `X-GitHub-Event` → route to push/PR/installation handler
- Return parsed `WebhookEvent`

**Step 2: Add webhook route to Hono server**

`POST /api/webhooks/github` — calls webhook handler, emits `deployment.requested` if auto-deploy matches.

**Step 3: Write tests for signature validation and replay protection**

**Step 4: Commit**

```bash
git add packages/git/ apps/server/
git commit -m "feat: add GitHub webhook receiver with signature validation and replay protection"
```

---

## Task 12: Git Package — Cloner + Auto-Deploy

**Files:**
- Create: `packages/git/src/clone.ts`
- Create: `packages/git/src/auto-deploy.ts`

**Step 1: Implement repository cloner**

`packages/git/src/clone.ts`:
- Clone via `git clone --depth 1 --single-branch --branch <branch> <url> <targetDir>`
- HTTPS auth via installation token injected into URL
- Support specific commit SHA checkout
- Support root directory filter
- Clone to `/tmp/otterstack-builds/{deploymentId}/`

**Step 2: Implement auto-deploy trigger**

`packages/git/src/auto-deploy.ts`:
- Match webhook event to `gitRepository` rows (repo + branch)
- Check watch paths filter (glob matching against changed files)
- Create `deployment` row with `source: "git_push"`
- Emit `deployment.requested` Inngest event

**Step 3: Write tests and commit**

```bash
git add packages/git/
git commit -m "feat: add repository cloner and auto-deploy trigger"
```

---

## Task 13: Secrets Package — Env Var Resolution + Encryption

**Files:**
- Modify: `packages/secrets/src/` (enhance existing)
- Create: `packages/secrets/src/encryption.ts`
- Create: `packages/secrets/src/env-resolver.ts`

**Step 1: Implement AES-256-GCM encryption**

`packages/secrets/src/encryption.ts`:
- `encrypt(plaintext, key)` → `{iv, ciphertext, tag}` concatenated as base64
- `decrypt(encrypted, key)` → plaintext
- Key from `ENCRYPTION_KEY` env var

**Step 2: Implement env var scope resolution**

`packages/secrets/src/env-resolver.ts`:
- `resolveEnvVars(resourceId, environmentId, projectId)` → merged key-value map
- Resolution order: project → environment → resource (later overrides earlier)
- Decrypt secret values
- Separate build-time vs runtime vars

**Step 3: Implement build-time vs runtime separation**

Filter by `isBuildTime` flag on each env var.

**Step 4: Write tests and commit**

```bash
git add packages/secrets/
git commit -m "feat: add AES-256-GCM encryption and env var scope resolution"
```

---

## Task 14: Secrets Package — Inter-Resource Refs + Snapshots

**Files:**
- Modify: `packages/secrets/src/env-resolver.ts`
- Create: `packages/secrets/src/snapshot.ts`
- Create: `packages/secrets/src/redaction.ts`

**Step 1: Implement inter-resource reference resolution**

In `env-resolver.ts`, add `${resourceName.property}` syntax resolution:
- `${db.connectionString}` → PostgreSQL URL
- `${cache.host}` → Redis hostname
- Query linked resources, build connection strings from their metadata

**Step 2: Implement deployment secret snapshot**

`packages/secrets/src/snapshot.ts`:
- `createSecretSnapshot(deploymentId, resolvedVars)` → encrypted JSONB row
- SHA256 digest for change detection
- Write to `deploymentSecretSnapshot` table

**Step 3: Implement log redaction**

`packages/secrets/src/redaction.ts`:
- `createRedactionFilter(secretValues)` → function that replaces known secrets with `[REDACTED]`
- Regex patterns for AWS keys, JWT tokens, Bearer tokens, basic auth
- Applied to build log streams before storage

**Step 4: Write tests and commit**

```bash
git add packages/secrets/
git commit -m "feat: add inter-resource refs, deployment snapshots, log redaction"
```

---

## Task 15: Proxy Package — Caddy Client + Config Builder

**Files:**
- Create: `packages/proxy/package.json`
- Create: `packages/proxy/tsconfig.json`
- Create: `packages/proxy/src/index.ts`
- Create: `packages/proxy/src/caddy-client.ts`
- Create: `packages/proxy/src/config-builder.ts`
- Create: `packages/proxy/src/middleware.ts`
- Create: `packages/proxy/src/types.ts`
- Create: `packages/proxy/vitest.config.ts`

**Step 1: Create package scaffolding**

Deps: `better-result`, `@otterdeploy/logger`

**Step 2: Implement Caddy Admin API client**

`packages/proxy/src/caddy-client.ts`:
```typescript
const CADDY_ADMIN = "http://127.0.0.1:2019";

export async function getConfig(): Promise<Result<CaddyConfig, Error>> { /* GET /config/ */ }
export async function addRoute(route: CaddyRoute, serverKey?: string): Promise<Result<void, Error>> { /* PATCH */ }
export async function removeRouteById(routeId: string): Promise<Result<void, Error>> { /* DELETE /id/{routeId} */ }
export async function updateRoute(routeId: string, route: CaddyRoute): Promise<Result<void, Error>> { /* PATCH /id/{routeId} */ }
export async function loadConfig(config: CaddyConfig): Promise<Result<void, Error>> { /* POST /load */ }
export async function healthCheck(): Promise<boolean> { /* GET /config/ returns 200 */ }
```

**Step 3: Implement route config builder**

`packages/proxy/src/config-builder.ts`:
- `buildRoute(resourceId, domain, upstream, port, opts)` → `CaddyRoute`
- Route ID scheme: `route-{resourceId}-{hash6(domain)}`
- Match on `host`, handle with `reverse_proxy` to `otterstack-{resourceId}:{port}`

**Step 4: Implement middleware helpers**

`packages/proxy/src/middleware.ts`:
- `createReverseProxyHandler(upstream, port)`
- `createCompressionHandler()`
- `createSecurityHeadersHandler()`

**Step 5: Write tests and commit**

```bash
git add packages/proxy/
git commit -m "feat: add proxy package with Caddy Admin API client and config builder"
```

---

## Task 16: Proxy Package — Container Lifecycle + Sync

**Files:**
- Create: `packages/proxy/src/container.ts`
- Create: `packages/proxy/src/sync.ts`

**Step 1: Implement Caddy container lifecycle**

`packages/proxy/src/container.ts`:
- `bootstrapCaddy()` — create Caddy Swarm service with `caddy:2-alpine`, `caddy run --resume`, volumes for data+config, ports 80/443/443-udp, admin API on 127.0.0.1:2019, connected to `otterstack-ingress`
- `isCaddyRunning()` — check service exists + health check
- `restartCaddy()` — self-healing: recreate if missing, reconnect to all project networks

**Step 2: Implement proxy sync orchestration**

`packages/proxy/src/sync.ts`:
- `syncResourceProxy(resourceId)` — build route for resource's domains, upsert via Caddy API
- `syncDomainProxy(domainId)` — add route for newly verified domain
- `removeResourceProxy(resourceId)` — remove route by `@id`
- `syncServerProxy()` — full resync: rebuild all routes from DB, atomic `loadConfig()`

**Step 3: Write tests and commit**

```bash
git add packages/proxy/
git commit -m "feat: add Caddy container lifecycle and proxy sync orchestration"
```

---

## Task 17: Deployment Pipeline — Validate + Clone + Secrets Steps

**Files:**
- Modify: `apps/worker/src/functions/deployment-pipeline.ts`

**Step 1: Implement Step 1 (validate)**

Replace stub `acquire-slot` with full validation:
- Fetch resource, environment, project from DB
- Check no other deployment is `building`/`deploying` for this resource
- If conflict: supersede older queued deployments
- Transition: `queued` → `building`
- Emit `deploymentEvent`

**Step 2: Implement Step 2 (clone)**

- If `buildMethod` is `docker_image`: skip
- Call `git.cloneRepository()` with resource's git config
- Clone to `/tmp/otterstack-builds/{deploymentId}/`
- Apply root directory filter

**Step 3: Implement Step 3 (resolve-secrets)**

- Call `secrets.resolveEnvVars()` with scope inheritance
- Resolve inter-resource references
- Create `deploymentSecretSnapshot`
- Separate build-time vs runtime vars

**Step 4: Write tests (mock Inngest step functions)**

**Step 5: Commit**

```bash
git add apps/worker/
git commit -m "feat: implement pipeline steps 1-3: validate, clone, resolve secrets"
```

---

## Task 18: Deployment Pipeline — Build + Deploy + Health Steps

**Files:**
- Modify: `apps/worker/src/functions/deployment-pipeline.ts`

**Step 1: Implement Step 4 (build)**

- Dispatch to builder via `getBuilder(buildMethod)`
- Pass build-time env vars
- Handle `force: true` (no-cache flags)
- Stream build logs to deployment events
- Tag image: `otterstack-{resourceId}:latest` + `v{N}`

**Step 2: Implement Step 5 (pre-deploy command)**

- If `preDeployCommand` set: run in temporary container with built image
- Connect to project network, inject runtime env vars
- Wait for exit 0, fail on non-zero

**Step 3: Implement Step 6 (deploy Swarm service)**

- Transition: `building` → `deploying`
- Check if service exists: update vs create
- Full service spec with UpdateConfig (start-first) and RollbackConfig
- Connect to project network + ingress network

**Step 4: Implement Step 7 (health check)**

- Poll Docker health check status or HTTP health endpoint
- Timeout: 120s, interval: 5s
- On healthy: proceed
- On timeout: mark failed (Swarm auto-rollback handles container)

**Step 5: Commit**

```bash
git add apps/worker/
git commit -m "feat: implement pipeline steps 4-7: build, pre-deploy, deploy, health check"
```

---

## Task 19: Deployment Pipeline — Route + Verify + Cleanup Steps

**Files:**
- Modify: `apps/worker/src/functions/deployment-pipeline.ts`

**Step 1: Implement Step 8 (route traffic)**

- Call `proxySync.syncResourceProxy(resourceId)`
- Build Caddy routes for each verified domain
- Push to Caddy Admin API via `updateRoute()` (idempotent by @id)

**Step 2: Implement Step 9 (verify)**

- Transition: `deploying` → `verifying`
- Confirm container running and receiving traffic
- Optional HTTP probe to public URL
- Transition: `verifying` → `live`
- Emit `deployment.released`, record `completedAt`

**Step 3: Implement Step 10 (cleanup)**

- Remove build directory
- Prune old image tags beyond retention (keep last 10)
- Update `previousImageTag` on deployment record

**Step 4: Commit**

```bash
git add apps/worker/
git commit -m "feat: implement pipeline steps 8-10: route, verify, cleanup"
```

---

## Task 20: Deployment Pipeline — Failure, Cancel, Rollback, Queue

**Files:**
- Modify: `apps/worker/src/functions/deployment-pipeline.ts`
- Create: `apps/worker/src/functions/deployment-rollback.ts`
- Create: `apps/worker/src/functions/deployment-cancel.ts`

**Step 1: Implement failure handling**

In `onFailure` handler: set deployment `failed`, emit `deployment.failed` event, log error. Previous service keeps running.

**Step 2: Implement cancellation**

`deployment-cancel.ts` — Inngest function on `deployment.cancel`:
- Check cancellation flag at step boundaries
- If building: kill build process
- If deploying: force rollback Swarm service
- Set status `canceled`

**Step 3: Implement rollback**

`deployment-rollback.ts` — Inngest function on `deployment.rollback.requested`:
- Look up target deployment's image tag
- `updateService()` with old image
- Health check → re-push Caddy config
- Create new deployment with `source: "rollback"`

**Step 4: Implement queue semantics**

- Per-resource mutex via Inngest concurrency key
- Superseded-commit collapse: cancel intermediate queued deployments
- Queue TTL: 1 hour expiry
- Dequeue next on completion/failure

**Step 5: Commit**

```bash
git add apps/worker/
git commit -m "feat: add deployment failure handling, cancellation, rollback, and queue semantics"
```

---

## Task 21: Database Provisioning — Provisioner + Flow

**Files:**
- Create: `packages/domain/src/database-provisioner.ts`
- Create: `apps/worker/src/functions/database-provision.ts`

**Step 1: Implement database provisioner config map**

`packages/domain/src/database-provisioner.ts`:
```typescript
export const DATABASE_CONFIGS = {
  postgresql: {
    image: "postgres:16",
    dataPath: "/var/lib/postgresql/data",
    healthCheck: "pg_isready -U $POSTGRES_USER",
    defaultPort: 5432,
    envMapping: { user: "POSTGRES_USER", password: "POSTGRES_PASSWORD", database: "POSTGRES_DB" },
  },
  redis: {
    image: "redis:7-alpine",
    dataPath: "/data",
    healthCheck: "redis-cli ping",
    defaultPort: 6379,
    envMapping: { password: "REDIS_PASSWORD" },
  },
  mysql: {
    image: "mysql:8",
    dataPath: "/var/lib/mysql",
    healthCheck: "mysqladmin ping -u root -p$MYSQL_ROOT_PASSWORD",
    defaultPort: 3306,
    envMapping: { user: "MYSQL_USER", password: "MYSQL_PASSWORD", database: "MYSQL_DATABASE", rootPassword: "MYSQL_ROOT_PASSWORD" },
  },
  mongodb: {
    image: "mongo:7",
    dataPath: "/data/db",
    healthCheck: "mongosh --eval \"db.runCommand('ping')\"",
    defaultPort: 27017,
    envMapping: { user: "MONGO_INITDB_ROOT_USERNAME", password: "MONGO_INITDB_ROOT_PASSWORD", database: "MONGO_INITDB_DATABASE" },
  },
} as const;
```

**Step 2: Implement provisioning Inngest function**

`apps/worker/src/functions/database-provision.ts`:
- On `resource.created` with `kind: database`/`cache`:
  - Generate random credentials
  - Store as secret references
  - Create named volume
  - Create Swarm service with correct image, env vars, volume, health check
  - Wait for health check
  - Store connection info in resource metadata

**Step 3: Implement connection string generation**

When linking resources: auto-generate `DATABASE_URL`, `REDIS_URL`, etc. using Swarm service names as hostnames.

**Step 4: Commit**

```bash
git add packages/domain/ apps/worker/
git commit -m "feat: add database provisioning with PostgreSQL, Redis, MySQL, MongoDB"
```

---

## Task 22: Database Provisioning — External Ports + Config + Versions

**Files:**
- Modify: `packages/domain/src/database-provisioner.ts`
- Create: `apps/worker/src/functions/database-upgrade.ts`

**Step 1: Implement external port exposure**

Optional Docker port mapping for external DB tools. Warn about security.

**Step 2: Implement custom config injection**

Mount custom `postgresql.conf`, `redis.conf`, `my.cnf` via Docker configs.

**Step 3: Implement version upgrade flow**

`database-upgrade.ts`:
1. Warn about incompatibility
2. Auto-trigger backup
3. Wait for backup success (abort if fails)
4. Scale to 0 → update image → scale to 1
5. Health check → auto-restore on failure

**Step 4: Commit**

```bash
git add packages/domain/ apps/worker/
git commit -m "feat: add DB external ports, custom config, and version upgrade with auto-backup"
```

---

## Task 23: Custom Domains — CRUD + DNS Verification

**Files:**
- Modify: `packages/domain/src/custom-domain.ts`
- Create: `apps/worker/src/functions/domain-verification.ts`

**Step 1: Enhance domain CRUD**

Complete `addDomain`, `removeDomain`, `listDomains`, `checkDomainConflict` (uniqueness across org).

**Step 2: Implement DNS verification**

`domain-verification.ts` — Inngest function:
- Phase 1: TXT record verification (`_otterstack-verify.example.com`)
- Phase 2: A/CNAME check (advisory)
- Cloudflare proxy detection (known IP ranges)
- On verified: emit `domain.verified` → triggers Caddy route push

**Step 3: Implement three-level domain resolution**

`resolveResourceDomain(resource, project, server)`:
1. Resource custom domain → use it
2. Project base domain → `{resourceName}.{projectBaseDomain}`
3. Server base domain → `{resourceName}-{projectSlug}.{serverBaseDomain}`

**Step 4: Commit**

```bash
git add packages/domain/ apps/worker/
git commit -m "feat: add custom domain CRUD with DNS verification and three-level domain resolution"
```

---

## Task 24: Custom Domains — SSL + Redirects

**Files:**
- Create: `apps/worker/src/functions/ssl-monitor.ts`
- Modify: `packages/domain/src/custom-domain.ts`

**Step 1: Implement SSL status tracking**

`ssl-monitor.ts` — scheduled Inngest function:
- Check certificate status via Caddy Admin API
- Update `sslStatus` and `sslExpiresAt` on `customDomain` rows

**Step 2: Implement custom certificate upload**

Accept PEM cert + key, validate, push to Caddy TLS config.

**Step 3: Implement redirect rules**

WWW redirect + custom redirect rules stored in `redirectRules` JSONB. Implemented as Caddy subroute handlers.

**Step 4: Commit**

```bash
git add packages/domain/ apps/worker/
git commit -m "feat: add SSL monitoring, custom certificates, and redirect rules"
```

---

## Task 25: Server Bootstrap — Setup Wizard + Health

**Files:**
- Create: `packages/domain/src/server-bootstrap.ts`
- Modify: `packages/api/src/routers/system.ts`
- Create: `apps/worker/src/functions/server-health.ts`

**Step 1: Implement bootstrap sequence**

`packages/domain/src/server-bootstrap.ts`:
1. Check Docker installed + version ≥ 24.0
2. Init Swarm (localhost only)
3. Create ingress network
4. Bootstrap Caddy service
5. Check/install Nixpacks
6. Verify port availability (80, 443, 2019-localhost, 2377-localhost)

**Step 2: Implement system health endpoint**

Enhance `packages/api/src/routers/system.ts`:
```typescript
// GET /api/system/health
{
  docker: { status, version, swarm },
  caddy: { status, version, adminApi },
  database: { status, latency },
  inngest: { status },
}
```

**Step 3: Implement setup wizard API**

Steps: create admin → create org → configure domain → configure ACME email → init Docker+Caddy

**Step 4: Implement server health monitoring**

`server-health.ts` — Inngest cron (every 60s):
- Docker daemon connectivity
- Swarm status
- Caddy health + auto-restart if down
- Disk usage checks

**Step 5: Commit**

```bash
git add packages/domain/ packages/api/ apps/worker/
git commit -m "feat: add server bootstrap, setup wizard, and health monitoring"
```

---

## Task 26: Hardening Gates — P0 Security + Reliability

**Files:**
- Create: `packages/docker/src/__tests__/security.test.ts`
- Create: `packages/git/src/__tests__/webhook-replay.test.ts`
- Create: `packages/secrets/src/__tests__/redaction.test.ts`
- Create: `apps/worker/src/__tests__/pipeline-idempotency.test.ts`

**Step 1: Port hardening tests**

`security.test.ts`:
- Assert Swarm `ListenAddr` is `127.0.0.1:2377`
- Assert Caddy admin is `127.0.0.1:2019`
- Assert neither port is bound to `0.0.0.0`

**Step 2: Webhook replay tests**

`webhook-replay.test.ts`:
- Send same `X-GitHub-Delivery` twice → second returns 200 OK but creates zero deployments
- Delivery IDs expire after 72 hours

**Step 3: Secret redaction tests**

`redaction.test.ts`:
- Verify no secret values appear in deployment event logs
- Verify AWS key patterns, JWT tokens, Bearer tokens are redacted

**Step 4: Pipeline idempotency tests**

`pipeline-idempotency.test.ts`:
- Retried clone step skips if build dir exists with correct SHA
- Retried build step skips if image tag exists
- Retried route step is idempotent (upsert by @id)

**Step 5: Rollback verification**

- Force failure during rolling update → verify Swarm auto-rollback fires
- Verify `RollbackConfig.FailureAction: "pause"` on rollback failure

**Step 6: Commit**

```bash
git add packages/docker/ packages/git/ packages/secrets/ apps/worker/
git commit -m "feat: add P0 hardening gate tests — security, replay, redaction, idempotency"
```

---

## End-to-End Verification

After all 26 tasks are complete, verify the full flow works:

1. Start OtterStack (`bun run dev`)
2. Server bootstrap runs: Docker check → Swarm init → Caddy start → Nixpacks check
3. Create a project + environment + resource via API
4. Configure GitHub App + webhook on the resource
5. Push code to GitHub
6. Webhook triggers → pipeline runs: clone → build → deploy → route
7. App is live at auto-generated URL with HTTPS
8. Verify rollback works
9. Verify database provisioning works (create PostgreSQL resource)
10. Verify custom domain with DNS verification works

---

## What's NOT in This Plan (P1 Operations — Separate Plan)

- Section 9: Monitoring & Health (stats collection, alerts, uptime)
- Section 10: Backup System (scheduled backups, S3 upload, restore)
- Section 12: Notification System (Slack, Discord, email, webhook)
- Section 13: Audit Logging (comprehensive audit writes + queries)
- Section 14: API Completion (all stubbed routers)
- Section 16 P1: Production readiness gates
- Section 2.6: Docker Compose / Stack support
- Section 3.12: Preview deployments (PR environments)
- Section 3.13: Generic Git clone (SSH/HTTPS without webhooks)
- Section 7.9-7.11: Bulk import, env var diffing, restart with new config
- Section 9.13: Scheduled task execution (cron jobs)
- Section 10.11: Control-plane disaster recovery
- Section 11.10: Self-update mechanism
