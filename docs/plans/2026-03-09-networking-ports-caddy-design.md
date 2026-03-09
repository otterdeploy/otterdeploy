# Networking, Port Mapping & Caddy Ingress Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken resource/networking model with a proper port mapping system, network policies for isolation, and Caddy Admin API integration for ingress routing.

**Architecture:** Resources get explicit `PortMapping` entries (auto-detected from builds or manually added). Domains bind to specific ports, not resources. Environment-scoped overlay networks provide default connectivity; `NetworkPolicy` entities create isolated sub-networks. Caddy routes are managed via its Admin API (not Docker labels). Database configs use discriminated unions per engine.

**Tech Stack:** Drizzle ORM (PostgreSQL), Docker Swarm overlay networks, Caddy Admin API, dockerode, better-result

---

## Summary of Changes

### What's changing:
1. `resourceKindEnum` → simplified to `"application" | "database"`
2. `databaseConfig` → discriminated union stored as JSONB per engine type
3. New `port_mapping` table → per-resource port entries with visibility
4. `custom_domain` → now references `portMappingId` instead of `resourceId`
5. New `network_policy` + `network_policy_member` tables
6. Remove `resourceComposeConfig` and `resourceJobConfig` tables (compose is a deploy mode, cron is a runtime config field)
7. `resourceRuntimeConfig.port` removed (replaced by `port_mapping` table)
8. New Caddy ingress module using Admin API
9. Updated `packages/docker/src/network.ts` for policy networks
10. Updated types.ts with all new types

### What's NOT changing:
- Project/Environment/Resource hierarchy
- Deployment pipeline structure
- Server/SSH/Git infrastructure
- Secrets, backups, audit logs, notifications
- Environment variables
- Volumes

---

## Task 1: Update Enums

**Files:**
- Modify: `packages/db/src/schema/enums.ts:106-112`

**Step 1: Write the new enums**

Replace `resourceKindEnum` and add new enums:

```typescript
export const resourceKindEnum = pgEnum("resource_kind", [
  "application",
  "database",
]);

export const portProtocolEnum = pgEnum("port_protocol", [
  "http",
  "tcp",
  "udp",
]);

export const portVisibilityEnum = pgEnum("port_visibility", [
  "public",
  "internal",
]);
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: May have errors from code referencing old enum values ("web", "api", "worker", "compose") — that's fine, we'll fix downstream.

**Step 3: Commit**

```bash
git add packages/db/src/schema/enums.ts
git commit -m "refactor: simplify resourceKindEnum, add port protocol/visibility enums"
```

---

## Task 2: Add Port Mapping Table

**Files:**
- Modify: `packages/db/src/schema/resource-config.ts`

**Step 1: Add the port_mapping table after the existing tables**

```typescript
import { portProtocolEnum, portVisibilityEnum } from "./enums";

export const portMapping = pgTable(
  "port_mapping",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    protocol: portProtocolEnum("protocol").notNull().default("http"),
    visibility: portVisibilityEnum("visibility").notNull().default("internal"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("port_mapping_resource_idx").on(table.resourceId),
    uniqueIndex("port_mapping_resource_port_proto_uidx").on(
      table.resourceId,
      table.port,
      table.protocol,
    ),
  ],
);

export const portMappingRelations = relations(portMapping, ({ one, many }) => ({
  resource: one(resource, {
    fields: [portMapping.resourceId],
    references: [resource.id],
  }),
  domains: many(customDomain),
}));
```

**Step 2: Remove `port` from `resourceRuntimeConfig`**

Delete the `port: integer("port"),` line from the `resourceRuntimeConfig` table definition.

**Step 3: Commit**

```bash
git add packages/db/src/schema/resource-config.ts
git commit -m "feat: add port_mapping table, remove port from runtime config"
```

---

## Task 3: Update Domain Binding to Reference Port Mapping

**Files:**
- Modify: `packages/db/src/schema/operations.ts:20-56`

**Step 1: Change `custom_domain` to reference `portMappingId`**

```typescript
import { portMapping } from "./resource-config";

export const customDomain = pgTable(
  "custom_domain",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    portMappingId: text("port_mapping_id")
      .notNull()
      .references(() => portMapping.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    verified: boolean("verified").notNull().default(false),
    verificationToken: text("verification_token"),
    sslStatus: sslStatusEnum("ssl_status").notNull().default("pending"),
    sslExpiresAt: timestamp("ssl_expires_at"),
    redirectRules: jsonb("redirect_rules")
      .$type<
        Array<{
          source: string;
          target: string;
          statusCode: 301 | 302;
          type: "www" | "custom";
        }>
      >()
      .default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_domain_org_idx").on(table.organizationId),
    index("custom_domain_port_mapping_idx").on(table.portMappingId),
    uniqueIndex("custom_domain_domain_unique").on(table.domain),
  ],
);

export const customDomainRelations = relations(customDomain, ({ one }) => ({
  organization: one(organization, {
    fields: [customDomain.organizationId],
    references: [organization.id],
  }),
  portMapping: one(portMapping, {
    fields: [customDomain.portMappingId],
    references: [portMapping.id],
  }),
}));
```

**Step 2: Commit**

```bash
git add packages/db/src/schema/operations.ts
git commit -m "refactor: domain binding now references port_mapping instead of resource"
```

---

## Task 4: Add Network Policy Tables

**Files:**
- Create: `packages/db/src/schema/networking.ts`
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Create the networking schema file**

```typescript
// packages/db/src/schema/networking.ts
import { createId } from "@otterdeploy/utils";
import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { environment, resource } from "./project";

export const networkPolicy = pgTable(
  "network_policy",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("network_policy_env_idx").on(table.environmentId),
    uniqueIndex("network_policy_env_name_uidx").on(table.environmentId, table.name),
  ],
);

export const networkPolicyMember = pgTable(
  "network_policy_member",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    networkPolicyId: text("network_policy_id")
      .notNull()
      .references(() => networkPolicy.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resource.id, { onDelete: "cascade" }),
    alias: text("alias"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("network_policy_member_policy_idx").on(table.networkPolicyId),
    index("network_policy_member_resource_idx").on(table.resourceId),
    uniqueIndex("network_policy_member_policy_resource_uidx").on(
      table.networkPolicyId,
      table.resourceId,
    ),
  ],
);

// --- Relations ---

export const networkPolicyRelations = relations(networkPolicy, ({ one, many }) => ({
  environment: one(environment, {
    fields: [networkPolicy.environmentId],
    references: [environment.id],
  }),
  members: many(networkPolicyMember),
}));

export const networkPolicyMemberRelations = relations(networkPolicyMember, ({ one }) => ({
  networkPolicy: one(networkPolicy, {
    fields: [networkPolicyMember.networkPolicyId],
    references: [networkPolicy.id],
  }),
  resource: one(resource, {
    fields: [networkPolicyMember.resourceId],
    references: [resource.id],
  }),
}));
```

**Step 2: Export from index**

Add to `packages/db/src/schema/index.ts`:

```typescript
export * from "./networking";
```

**Step 3: Commit**

```bash
git add packages/db/src/schema/networking.ts packages/db/src/schema/index.ts
git commit -m "feat: add network_policy and network_policy_member tables"
```

---

## Task 5: Replace DatabaseConfig with Discriminated Union JSONB

**Files:**
- Modify: `packages/db/src/schema/resource-config.ts:112-136`

**Step 1: Define the discriminated union type**

Add above the table definition:

```typescript
// --- Database Config Types (discriminated union) ---

interface BaseDatabase {
  image: string;
  version?: string;
  persistenceEnabled?: boolean;
  backupEnabled?: boolean;
  memoryLimit?: number;
  cpuLimit?: number;
}

interface PostgresEngineConfig extends BaseDatabase {
  engine: "postgresql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  sharedBuffers?: string;
  extensions?: string[];
}

interface MySqlEngineConfig extends BaseDatabase {
  engine: "mysql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

interface MariaDbEngineConfig extends BaseDatabase {
  engine: "mariadb";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

interface MongoEngineConfig extends BaseDatabase {
  engine: "mongodb";
  databaseName: string;
  replicaSet?: string;
  wiredTigerCacheSize?: string;
}

interface RedisEngineConfig extends BaseDatabase {
  engine: "redis";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  appendOnly?: boolean;
}

interface KeyDbEngineConfig extends BaseDatabase {
  engine: "keydb";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  activeReplica?: boolean;
  multiMaster?: boolean;
}

interface DragonflyEngineConfig extends BaseDatabase {
  engine: "dragonfly";
  maxMemory?: string;
  cacheMode?: boolean;
}

interface ClickHouseEngineConfig extends BaseDatabase {
  engine: "clickhouse";
  databaseName: string;
  databaseUser: string;
  maxMemoryUsage?: string;
}

export type DatabaseEngineConfig =
  | PostgresEngineConfig
  | MySqlEngineConfig
  | MariaDbEngineConfig
  | MongoEngineConfig
  | RedisEngineConfig
  | KeyDbEngineConfig
  | DragonflyEngineConfig
  | ClickHouseEngineConfig;
```

**Step 2: Simplify the `databaseConfig` table**

```typescript
export const databaseConfig = pgTable(
  "database_config",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    resourceId: text("resource_id")
      .notNull()
      .unique()
      .references(() => resource.id, { onDelete: "cascade" }),
    engine: databaseTypeEnum("engine").notNull(),
    config: jsonb("config").$type<DatabaseEngineConfig>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("database_config_resource_idx").on(table.resourceId),
    index("database_config_engine_idx").on(table.engine),
  ],
);
```

**Step 3: Remove `resourceComposeConfig` and `resourceJobConfig` tables**

Delete the `resourceComposeConfig` table (lines 93-110) and `resourceJobConfig` table (lines 72-91) and their relations. Also remove them from imports in `project.ts`.

**Step 4: Add `cronSchedule` and `cronCommand` as optional fields on `resourceRuntimeConfig`**

```typescript
// Add these fields to resourceRuntimeConfig:
cronSchedule: text("cron_schedule"),
cronCommand: text("cron_command"),
```

**Step 5: Commit**

```bash
git add packages/db/src/schema/resource-config.ts packages/db/src/schema/project.ts
git commit -m "refactor: database config as discriminated union JSONB, remove compose/job config tables"
```

---

## Task 6: Update Resource Relations in project.ts

**Files:**
- Modify: `packages/db/src/schema/project.ts:148-186`

**Step 1: Update resource relations**

Remove `jobConfig`, `composeConfig` relations. Add `portMappings` and `networkPolicyMemberships`:

```typescript
import { portMapping } from "./resource-config";
import { networkPolicyMember } from "./networking";

export const resourceRelations = relations(resource, ({ one, many }) => ({
  organization: one(organization, {
    fields: [resource.organizationId],
    references: [organization.id],
  }),
  project: one(project, {
    fields: [resource.projectId],
    references: [project.id],
  }),
  environment: one(environment, {
    fields: [resource.environmentId],
    references: [environment.id],
  }),
  position: one(resourcePosition, {
    fields: [resource.id],
    references: [resourcePosition.resourceId],
  }),
  runtimeConfig: one(resourceRuntimeConfig, {
    fields: [resource.id],
    references: [resourceRuntimeConfig.resourceId],
  }),
  buildConfig: one(resourceBuildConfig, {
    fields: [resource.id],
    references: [resourceBuildConfig.resourceId],
  }),
  databaseConfig: one(databaseConfig, {
    fields: [resource.id],
    references: [databaseConfig.resourceId],
  }),
  portMappings: many(portMapping),
  networkPolicyMemberships: many(networkPolicyMember),
  volumeMounts: many(resourceVolumeMount),
}));
```

**Step 2: Add environment → networkPolicies relation**

```typescript
export const environmentRelations = relations(environment, ({ one, many }) => ({
  project: one(project, {
    fields: [environment.projectId],
    references: [project.id],
  }),
  resources: many(resource),
  networkPolicies: many(networkPolicy),
  viewport: one(viewport, {
    fields: [environment.id],
    references: [viewport.environmentId],
  }),
}));
```

**Step 3: Commit**

```bash
git add packages/db/src/schema/project.ts
git commit -m "refactor: update resource/environment relations for ports and network policies"
```

---

## Task 7: Update types.ts

**Files:**
- Modify: `apps/web/src/lib/types.ts`

**Step 1: Update the full types file**

See Task 7 code block below. This is the complete rewrite of the types file reflecting all schema changes.

**Step 2: Commit**

```bash
git add apps/web/src/lib/types.ts
git commit -m "refactor: update types for port mappings, network policies, database union config"
```

---

## Task 8: Update Docker Network Module for Policy Networks

**Files:**
- Modify: `packages/docker/src/network.ts`

**Step 1: Add policy network name helper**

```typescript
function policyNetworkName(
  projectId: string,
  environmentId: string,
  policyName: string,
): string {
  const projShort = projectId.slice(0, 8);
  const envShort = environmentId.slice(0, 8);
  return `otterstack-${projShort}-${envShort}-${policyName}`;
}
```

**Step 2: Add `createPolicyNetwork` function**

```typescript
export async function createPolicyNetwork(
  projectId: string,
  environmentId: string,
  policyName: string,
): Promise<Result<NetworkCreateResult, Error>> {
  const docker = getDockerClient();
  const networkName = policyNetworkName(projectId, environmentId, policyName);

  try {
    const networks = await docker.listNetworks({
      filters: { name: [networkName] },
    });
    const existing = networks.find((n) => n.Name === networkName);

    if (existing) {
      log.info({ networkId: existing.Id, policyName }, "Policy network already exists");
      return Result.ok({ networkId: existing.Id, alreadyExists: true });
    }

    const network = await docker.createNetwork({
      Name: networkName,
      Driver: "overlay",
      Attachable: true,
      Options: { encrypted: "true" },
      Labels: {
        "otterstack.managed": "true",
        "otterstack.project.id": projectId,
        "otterstack.environment.id": environmentId,
        "otterstack.network.role": "policy",
        "otterstack.network.policy": policyName,
      },
    });

    log.info({ networkId: network.id, policyName }, "Policy network created");

    // Connect Caddy to policy network so it can route to public services on it
    const caddy = await findCaddyService(docker);
    if (caddy) {
      const caddyInfo = await caddy.inspect();
      try {
        await connectServiceToNetworkById(docker, caddyInfo.ID, networkName);
        log.info({ policyName }, "Caddy connected to policy network");
      } catch (connectErr) {
        log.warn({ err: connectErr, policyName }, "Failed to connect Caddy to policy network");
      }
    }

    return Result.ok({ networkId: network.id, alreadyExists: false });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, policyName }, "Failed to create policy network");
    return Result.err(err);
  }
}
```

**Step 3: Add `removePolicyNetwork` function**

```typescript
export async function removePolicyNetwork(
  projectId: string,
  environmentId: string,
  policyName: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();
  const networkName = policyNetworkName(projectId, environmentId, policyName);

  try {
    const caddy = await findCaddyService(docker);
    if (caddy) {
      const caddyInfo = await caddy.inspect();
      try {
        await disconnectServiceFromNetworkById(docker, caddyInfo.ID, networkName);
      } catch (disconnectErr) {
        log.warn({ err: disconnectErr, policyName }, "Failed to disconnect Caddy from policy network");
      }
    }

    const network = docker.getNetwork(networkName);
    await network.remove();
    log.info({ policyName }, "Policy network removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, policyName }, "Failed to remove policy network");
    return Result.err(err);
  }
}
```

**Step 4: Export helpers**

```typescript
export { projectNetworkName, policyNetworkName };
```

**Step 5: Commit**

```bash
git add packages/docker/src/network.ts
git commit -m "feat: add policy network create/remove for network isolation"
```

---

## Task 9: Create Caddy Ingress Module

**Files:**
- Create: `packages/caddy/src/client.ts`
- Create: `packages/caddy/src/routes.ts`
- Create: `packages/caddy/src/types.ts`
- Create: `packages/caddy/src/index.ts`
- Create: `packages/caddy/package.json`
- Create: `packages/caddy/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@otterdeploy/caddy",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@otterdeploy/logger": "workspace:*",
    "better-result": "*"
  }
}
```

**Step 2: Create types**

```typescript
// packages/caddy/src/types.ts
export interface CaddyRoute {
  "@id"?: string;
  match?: Array<{ host?: string[] }>;
  handle: CaddyHandler[];
  terminal?: boolean;
}

export interface CaddyHandler {
  handler: "reverse_proxy" | "static_response" | "subroute";
  upstreams?: Array<{ dial: string }>;
  routes?: CaddyRoute[];
  status_code?: number;
  body?: string;
}

export interface CaddyRouteInput {
  routeId: string;
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "http" | "tcp";
}

export interface CaddyTcpRouteInput {
  routeId: string;
  listenPort: number;
  upstreamHost: string;
  upstreamPort: number;
}
```

**Step 3: Create client**

```typescript
// packages/caddy/src/client.ts
import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

const log = createLogger("caddy:client");

let adminUrl = "http://localhost:2019";

export function setCaddyAdminUrl(url: string) {
  adminUrl = url;
}

export async function caddyRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<Result<T, Error>> {
  try {
    const res = await fetch(`${adminUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      return Result.err(new Error(`Caddy API ${method} ${path}: ${res.status} ${text}`));
    }

    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return Result.ok(undefined as T);
    }

    const data = await res.json();
    return Result.ok(data as T);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, method, path }, "Caddy API request failed");
    return Result.err(err);
  }
}
```

**Step 4: Create routes module**

```typescript
// packages/caddy/src/routes.ts
import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import { caddyRequest } from "./client";
import type { CaddyRouteInput } from "./types";

const log = createLogger("caddy:routes");

export async function upsertHttpRoute(input: CaddyRouteInput): Promise<Result<void, Error>> {
  const { routeId, domain, upstreamHost, upstreamPort } = input;

  const route = {
    "@id": routeId,
    match: [{ host: [domain] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `${upstreamHost}:${upstreamPort}` }],
      },
    ],
    terminal: true,
  };

  // Try PATCH (update) first, fall back to POST (create)
  const patchResult = await caddyRequest("PATCH", `/id/${routeId}`, route);
  if (patchResult.ok) {
    log.info({ routeId, domain }, "HTTP route updated");
    return Result.ok(undefined);
  }

  // Route doesn't exist yet — append it
  const postResult = await caddyRequest(
    "POST",
    "/config/apps/http/servers/srv0/routes",
    route,
  );
  if (!postResult.ok) {
    return Result.err(postResult.error);
  }

  log.info({ routeId, domain }, "HTTP route created");
  return Result.ok(undefined);
}

export async function removeRoute(routeId: string): Promise<Result<void, Error>> {
  const result = await caddyRequest("DELETE", `/id/${routeId}`);
  if (!result.ok) {
    log.warn({ routeId, err: result.error }, "Failed to remove route (may not exist)");
    return result as Result<void, Error>;
  }

  log.info({ routeId }, "Route removed");
  return Result.ok(undefined);
}

export async function listRoutes(): Promise<Result<unknown[], Error>> {
  return caddyRequest<unknown[]>("GET", "/config/apps/http/servers/srv0/routes");
}
```

**Step 5: Create index**

```typescript
// packages/caddy/src/index.ts
export { setCaddyAdminUrl, caddyRequest } from "./client";
export { upsertHttpRoute, removeRoute, listRoutes } from "./routes";
export type { CaddyRoute, CaddyHandler, CaddyRouteInput, CaddyTcpRouteInput } from "./types";
```

**Step 6: Commit**

```bash
git add packages/caddy/
git commit -m "feat: add @otterdeploy/caddy package for Admin API route management"
```

---

## Task 10: Generate Migration

**Step 1: Generate Drizzle migration**

Run: `bun run db:generate`

**Step 2: Review the generated SQL**

Check `packages/db/drizzle/` for the new migration file. Verify it includes:
- `ALTER TABLE resource_kind` enum changes
- `CREATE TABLE port_mapping`
- `CREATE TABLE network_policy`
- `CREATE TABLE network_policy_member`
- `ALTER TABLE custom_domain` drop `resource_id`, add `port_mapping_id`
- `ALTER TABLE database_config` restructure
- `DROP TABLE resource_compose_config`
- `DROP TABLE resource_job_config`
- `ALTER TABLE resource_runtime_config` drop `port`, add `cron_schedule`, `cron_command`

**Step 3: Commit**

```bash
git add packages/db/drizzle/
git commit -m "chore: generate migration for networking and port mapping schema"
```

---

## Task 7 Code: Updated types.ts

This is the complete updated `apps/web/src/lib/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// 1. Branded ID
// ---------------------------------------------------------------------------

export type Id<T extends string> = T & { readonly __brand: unique symbol };

// ---------------------------------------------------------------------------
// 2. Enums (union types matching DB enums)
// ---------------------------------------------------------------------------

export type ResourceKind = "application" | "database";

export type ResourceStatus =
  | "online"
  | "degraded"
  | "crashed"
  | "deploying"
  | "stopped"
  | "unknown";

export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "verifying"
  | "live"
  | "failed"
  | "canceled"
  | "rolled_back";

export type DeploymentSource =
  | "git_push"
  | "manual"
  | "rollback"
  | "api"
  | "preview"
  | "config_change";

export type BuilderType = "nixpacks" | "dockerfile" | "buildpack" | "railpack";

export type DatabaseEngine =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "mongodb"
  | "redis"
  | "keydb"
  | "dragonfly"
  | "clickhouse";

export type RestartPolicy = "ON_FAILURE" | "ALWAYS" | "NEVER";

export type PortProtocol = "http" | "tcp" | "udp";

export type PortVisibility = "public" | "internal";

export type SslStatus = "pending" | "active" | "failed" | "expired";

export type ServerStatus = "connected" | "disconnected" | "provisioning" | "error";

export type ServerRole = "manager" | "worker";

export type BackupStatus = "pending" | "running" | "completed" | "failed";

export type CaddyStatus = "not_installed" | "initializing" | "running" | "stopped" | "error";

export type SecretProvider = "infisical" | "native_breakglass";

export type SecretKind = "env_var" | "ssh_private_key" | "git_client_secret" | "git_webhook_secret";

export type SecretLogicalScope = "organization" | "project" | "environment" | "resource";

export type SecretProviderBindingStatus = "provisioning" | "active" | "error";

export type MemberRole = "owner" | "admin" | "member";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type MetricKind =
  | "cpu"
  | "memory"
  | "disk"
  | "network_ingress"
  | "network_egress"
  | "latency"
  | "requests"
  | "errors";

export type ActorType = "user" | "system";

export type RedirectStatusCode = 301 | 302;
export type RedirectType = "www" | "custom";

// ---------------------------------------------------------------------------
// 3. Base Entity
// ---------------------------------------------------------------------------

export interface Entity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// 4. Organization & Auth
// ---------------------------------------------------------------------------

export interface Organization {
  id: Id<"organization">;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: string | null;
  createdAt: Date;
}

export interface User {
  id: Id<"user">;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role?: string | null;
  banned?: boolean | null;
  twoFactorEnabled?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  id: string;
  organizationId: Id<"organization">;
  userId: Id<"user">;
  role: MemberRole;
  createdAt: Date;
  user?: User;
}

// ---------------------------------------------------------------------------
// 5. Project Hierarchy
// ---------------------------------------------------------------------------

export interface Project extends Entity {
  organizationId?: Id<"organization"> | null;
  ownerId: Id<"user">;
  name: string;
  slug: string;
  baseDomain?: string | null;
  deletedAt?: Date | null;
  owner?: User;
  environments?: Environment[];
}

export interface Environment extends Entity {
  projectId: Id<"project">;
  name: string;
  slug: string;
  resources?: Resource[];
  networkPolicies?: NetworkPolicy[];
  viewport?: Viewport;
}

// ---------------------------------------------------------------------------
// 6. Infrastructure
// ---------------------------------------------------------------------------

export interface Server extends Entity {
  organizationId: Id<"organization">;
  name: string;
  ipAddress: string;
  port: number;
  sshKeyId?: string | null;
  status: ServerStatus;
  role: ServerRole;
  dockerVersion?: string | null;
  os?: string | null;
  arch?: string | null;
  totalMemory?: number | null;
  totalCpu?: number | null;
  totalDisk?: number | null;
  swarmNodeId?: string | null;
  baseDomain?: string | null;
  dockerCleanupThreshold?: number | null;
  lastSeenAt?: Date | null;
  sshKey?: SshKey;
}

export interface CaddyInstance extends Entity {
  serverId: Id<"server">;
  status: CaddyStatus;
  version?: string | null;
  acmeEmail?: string | null;
  lastHealthCheckAt?: Date | null;
  errorMessage?: string | null;
}

export interface SshKey extends Entity {
  organizationId: Id<"organization">;
  name: string;
  publicKey: string;
  privateKeySecretReferenceId?: string | null;
  fingerprint: string;
}

export interface GitProvider extends Entity {
  organizationId: Id<"organization">;
  type: string;
  name: string;
  appId?: string | null;
  clientId?: string | null;
  clientSecretReferenceId?: string | null;
  installationId?: string | null;
  webhookSecretReferenceId?: string | null;
}

export interface GitRepository extends Entity {
  resourceId: Id<"resource">;
  gitProviderId: Id<"gitProvider">;
  owner: string;
  name: string;
  branch: string;
  rootDirectory?: string | null;
  autoDeploy: boolean;
  webhookId?: string | null;
  watchPaths?: string[] | null;
}

export interface ContainerRegistry extends Entity {
  organizationId: Id<"organization">;
  name: string;
  url: string;
  username?: string | null;
  passwordSecretRefId?: string | null;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// 7. Secrets
// ---------------------------------------------------------------------------

export interface SecretProviderBinding extends Entity {
  organizationId: Id<"organization">;
  provider: SecretProvider;
  providerProjectId: string;
  providerProjectSlug: string;
  status: SecretProviderBindingStatus;
  metadata: Record<string, unknown>;
}

export interface SecretReference extends Entity {
  organizationId: Id<"organization">;
  provider: SecretProvider;
  kind: SecretKind;
  logicalScope: SecretLogicalScope;
  logicalScopeId: string;
  key: string;
  providerPath: string;
  providerKey: string;
  providerVersion?: string | null;
  lastResolvedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// 8. Environment Variables
// ---------------------------------------------------------------------------

export interface EnvironmentVariable extends Entity {
  organizationId: Id<"organization">;
  projectId?: Id<"project"> | null;
  environmentId?: Id<"environment"> | null;
  resourceId?: Id<"resource"> | null;
  key: string;
  secretReferenceId?: string | null;
  encryptedValue: string;
  isBuildTime: boolean;
  isSecret: boolean;
}

// ---------------------------------------------------------------------------
// 9. Port Mappings
// ---------------------------------------------------------------------------

export interface PortMapping extends Entity {
  resourceId: Id<"resource">;
  port: number;
  protocol: PortProtocol;
  visibility: PortVisibility;
  domains?: DomainBinding[];
}

// ---------------------------------------------------------------------------
// 10. Domains
// ---------------------------------------------------------------------------

export interface RedirectRule {
  source: string;
  target: string;
  statusCode: RedirectStatusCode;
  type: RedirectType;
}

export interface DomainBinding extends Entity {
  organizationId: Id<"organization">;
  portMappingId: Id<"portMapping">;
  domain: string;
  verified: boolean;
  verificationToken?: string | null;
  sslStatus: SslStatus;
  sslExpiresAt?: Date | null;
  redirectRules?: RedirectRule[];
  portMapping?: PortMapping;
}

// ---------------------------------------------------------------------------
// 11. Network Policies
// ---------------------------------------------------------------------------

export interface NetworkPolicy extends Entity {
  environmentId: Id<"environment">;
  name: string;
  members?: NetworkPolicyMember[];
}

export interface NetworkPolicyMember {
  id: string;
  networkPolicyId: Id<"networkPolicy">;
  resourceId: Id<"resource">;
  alias?: string | null;
  createdAt: Date;
  resource?: Resource;
}

// ---------------------------------------------------------------------------
// 12. Volumes
// ---------------------------------------------------------------------------

export interface Volume extends Entity {
  organizationId: string;
  name: string;
  driver?: string | null;
  sizeGb?: number | null;
  storageClass?: string | null;
}

export interface VolumeMount {
  id: string;
  volumeId: Id<"volume">;
  resourceId: Id<"resource">;
  mountPath: string;
  readOnly?: boolean | null;
  createdAt: Date;
  volume?: Volume;
}

// ---------------------------------------------------------------------------
// 13. Resource Build Config
// ---------------------------------------------------------------------------

export interface ResourceBuildConfig extends Entity {
  resourceId: Id<"resource">;
  registryId?: string | null;
  builder?: BuilderType | null;
  dockerfilePath?: string | null;
  buildCommand?: string | null;
  watchPatterns?: string[] | null;
  rootDirectory?: string | null;
  preDeployCommand?: string | null;
}

// ---------------------------------------------------------------------------
// 14. Runtime Config
// ---------------------------------------------------------------------------

export interface ResourceRuntimeConfig extends Entity {
  resourceId: Id<"resource">;
  startCommand?: string | null;
  restartPolicy?: RestartPolicy | null;
  restartPolicyMaxRetries?: number | null;
  replicas?: number | null;
  cpuLimit?: number | null;
  memoryLimit?: number | null;
  region?: string | null;
  sleepApplication?: boolean | null;
  healthCheckPath?: string | null;
  healthCheckInterval?: number | null;
  healthCheckTimeout?: number | null;
  cronSchedule?: string | null;
  cronCommand?: string | null;
}

// ---------------------------------------------------------------------------
// 15. Database Config (discriminated union)
// ---------------------------------------------------------------------------

interface BaseDatabase {
  image: string;
  version?: string;
  persistenceEnabled?: boolean;
  backupEnabled?: boolean;
  memoryLimit?: number;
  cpuLimit?: number;
}

export interface PostgresConfig extends BaseDatabase {
  engine: "postgresql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  sharedBuffers?: string;
  extensions?: string[];
}

export interface MySqlConfig extends BaseDatabase {
  engine: "mysql";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

export interface MariaDbConfig extends BaseDatabase {
  engine: "mariadb";
  databaseName: string;
  databaseUser: string;
  maxConnections?: number;
  innodbBufferPoolSize?: string;
}

export interface MongoConfig extends BaseDatabase {
  engine: "mongodb";
  databaseName: string;
  replicaSet?: string;
  wiredTigerCacheSize?: string;
}

export interface RedisConfig extends BaseDatabase {
  engine: "redis";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  appendOnly?: boolean;
}

export interface KeyDbConfig extends BaseDatabase {
  engine: "keydb";
  maxMemory?: string;
  evictionPolicy?: "noeviction" | "allkeys-lru" | "volatile-lru" | "allkeys-random" | "volatile-random" | "volatile-ttl";
  activeReplica?: boolean;
  multiMaster?: boolean;
}

export interface DragonflyConfig extends BaseDatabase {
  engine: "dragonfly";
  maxMemory?: string;
  cacheMode?: boolean;
}

export interface ClickHouseConfig extends BaseDatabase {
  engine: "clickhouse";
  databaseName: string;
  databaseUser: string;
  maxMemoryUsage?: string;
}

export type DatabaseConfig =
  | PostgresConfig
  | MySqlConfig
  | MariaDbConfig
  | MongoConfig
  | RedisConfig
  | KeyDbConfig
  | DragonflyConfig
  | ClickHouseConfig;

export interface DatabaseConfigRecord extends Entity {
  resourceId: Id<"resource">;
  engine: DatabaseEngine;
  config: DatabaseConfig;
}

// ---------------------------------------------------------------------------
// 16. Resources
// ---------------------------------------------------------------------------

export interface BaseResource extends Entity {
  organizationId: Id<"organization">;
  projectId: Id<"project">;
  environmentId: Id<"environment">;
  serverId?: string | null;
  kind: ResourceKind;
  name: string;
  status: ResourceStatus;
  deletedAt?: Date | null;

  // Relations (optional, loaded via joins)
  runtimeConfig?: ResourceRuntimeConfig | null;
  buildConfig?: ResourceBuildConfig | null;
  databaseConfig?: DatabaseConfigRecord | null;
  position?: ResourcePosition | null;
  portMappings?: PortMapping[];
  networkPolicyMemberships?: NetworkPolicyMember[];
  domains?: DomainBinding[];
  volumeMounts?: VolumeMount[];
  variables?: EnvironmentVariable[];
  deployments?: Deployment[];
  configFiles?: ConfigFile[];
  gitRepository?: GitRepository | null;
}

export interface ApplicationResource extends BaseResource {
  kind: "application";
}

export interface DatabaseResource extends BaseResource {
  kind: "database";
  databaseConfig: DatabaseConfigRecord;
}

export type Resource = ApplicationResource | DatabaseResource;

// ---------------------------------------------------------------------------
// 17. Deployments
// ---------------------------------------------------------------------------

export interface Deployment extends Entity {
  organizationId: string;
  projectId: Id<"project">;
  environmentId: Id<"environment">;
  resourceId: Id<"resource">;
  status: DeploymentStatus;
  source: DeploymentSource;
  gitRef?: string | null;
  gitCommitSha?: string | null;
  gitCommitMessage?: string | null;
  builder?: BuilderType | null;
  imageTag?: string | null;
  previousImageTag?: string | null;
  logPath?: string | null;
  logServerId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  finishedAt?: Date | null;
  duration?: number | null;
  errorMessage?: string | null;
  triggeredBy?: Id<"user"> | null;
  idempotencyKey?: string | null;
  events?: DeploymentEvent[];
  triggeredByUser?: User;
}

export interface DeploymentEvent {
  id: string;
  deploymentId: Id<"deployment">;
  status: DeploymentStatus;
  previousStatus?: DeploymentStatus | null;
  actor?: string | null;
  reason?: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 18. Backups
// ---------------------------------------------------------------------------

export interface BackupSchedule extends Entity {
  organizationId: Id<"organization">;
  resourceId: Id<"resource">;
  cronExpression: string;
  enabled: boolean;
  retentionCount?: number | null;
  retentionDays?: number | null;
  retentionMaxSizeGb?: number | null;
  s3Bucket?: string | null;
  s3Region?: string | null;
  s3Endpoint?: string | null;
  s3AccessKeyRef?: string | null;
  s3SecretKeyRef?: string | null;
}

export interface Backup {
  id: string;
  organizationId: Id<"organization">;
  resourceId: Id<"resource">;
  type: string;
  status: BackupStatus;
  storageKey?: string | null;
  size?: number | null;
  checksum?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 19. Config Files
// ---------------------------------------------------------------------------

export interface ConfigFile extends Entity {
  organizationId: Id<"organization">;
  resourceId: Id<"resource">;
  filename: string;
  content: string;
  mountPath: string;
}

// ---------------------------------------------------------------------------
// 20. Notifications
// ---------------------------------------------------------------------------

export interface NotificationChannel extends Entity {
  organizationId: Id<"organization">;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  eventFilter?: unknown;
}

// ---------------------------------------------------------------------------
// 21. Audit Log
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  organizationId?: Id<"organization"> | null;
  actorType: ActorType;
  actorUserId?: Id<"user"> | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// 22. Logs (frontend view types, not DB tables)
// ---------------------------------------------------------------------------

export interface BaseLogEntry {
  id: string;
  projectId: Id<"project">;
  environmentId: Id<"environment">;
  resourceId: Id<"resource">;
  timestamp: Date;
  level: LogLevel;
  message: string;
  labels?: Record<string, string>;
}

export interface BuildLogEntry extends BaseLogEntry {
  kind: "build";
  deploymentId: Id<"deployment">;
  phase: "prepare" | "install" | "build" | "package" | "push";
  step?: string;
}

export interface DeployLogEntry extends BaseLogEntry {
  kind: "deploy";
  deploymentId: Id<"deployment">;
  phase:
    | "queued"
    | "provisioning"
    | "starting"
    | "healthcheck"
    | "ready"
    | "restart"
    | "rollback"
    | "terminated";
}

export interface RuntimeLogEntry extends BaseLogEntry {
  kind: "runtime";
  stream: "stdout" | "stderr";
  instanceId?: string;
}

export interface HttpLogEntry extends BaseLogEntry {
  kind: "http";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  path: string;
  statusCode: number;
  durationMs: number;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export interface NetworkFlowLogEntry extends BaseLogEntry {
  kind: "network";
  sourceResourceId: Id<"resource">;
  destinationResourceId?: Id<"resource">;
  direction: "ingress" | "egress" | "internal";
  protocol: "tcp" | "udp" | "http" | "https" | "grpc";
  host?: string;
  port?: number;
  bytesIn?: number;
  bytesOut?: number;
  latencyMs?: number;
}

export type LogEntry =
  | BuildLogEntry
  | DeployLogEntry
  | RuntimeLogEntry
  | HttpLogEntry
  | NetworkFlowLogEntry;

// ---------------------------------------------------------------------------
// 23. Metrics (frontend view types)
// ---------------------------------------------------------------------------

export interface MetricPoint {
  timestamp: Date;
  value: number;
}

export interface MetricSeries {
  resourceId: Id<"resource">;
  kind: MetricKind;
  unit: string;
  points: MetricPoint[];
}

export interface ResourceMetricSnapshot {
  id: string;
  resourceId: Id<"resource">;
  timestamp: Date;
  cpuPercent?: number | null;
  memoryUsed?: number | null;
  memoryLimit?: number | null;
  networkRx?: number | null;
  networkTx?: number | null;
  diskRead?: number | null;
  diskWrite?: number | null;
}

// ---------------------------------------------------------------------------
// 24. Canvas
// ---------------------------------------------------------------------------

export interface ResourcePosition {
  resourceId: Id<"resource">;
  posX: number;
  posY: number;
  updatedAt: Date;
}

export interface Viewport {
  environmentId: Id<"environment">;
  x: number;
  y: number;
  zoom: number;
  updatedAt: Date;
}
```

---

## Execution Order

```
Task 1  (enums)
  ↓
Task 2  (port_mapping table)
  ↓
Task 3  (domain → port_mapping FK)
  ↓
Task 4  (network_policy tables)
  ↓
Task 5  (database config union)
  ↓
Task 6  (resource relations update)
  ↓
Task 7  (types.ts update)
  ↓
Task 8  (docker network module)
  ↓
Task 9  (caddy package)
  ↓
Task 10 (migration)
```

Tasks 7-9 are independent of each other and can run in parallel after Task 6.
