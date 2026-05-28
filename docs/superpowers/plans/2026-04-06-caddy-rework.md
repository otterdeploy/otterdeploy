# Caddy Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-based Caddy integration with a DB-driven reconciler that builds a single Caddyfile, validates per-project, and loads via Caddy's admin API.

**Architecture:** New `proxy_route` table stores structured route data. A reconciler queries all routes, builds per-project Caddyfile fragments, validates each via `/adapt`, assembles the final Caddyfile, and loads it via `/load`. Old `caddy_config` table, file sync, and claim extraction pipeline are deleted.

**Tech Stack:** Drizzle ORM, Caddy admin API, Vitest, Bun

**Spec:** `docs/superpowers/specs/2026-04-06-caddy-rework-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/db/src/schema/proxy-route.ts` | `proxy_route` table + enums |
| Create | `packages/api/src/caddy/queries.ts` | CRUD queries for proxy_route (queries live in API, not DB) |
| Create | `packages/api/src/caddy/builder.ts` | Pure Caddyfile builder functions |
| Create | `packages/api/src/caddy/client.ts` | Caddy admin API HTTP client |
| Create | `packages/api/src/caddy/reconciler.ts` | Reconciliation controller |
| Create | `packages/api/src/caddy/__tests__/builder.test.ts` | Builder unit tests |
| Create | `packages/api/src/caddy/__tests__/reconciler.test.ts` | Reconciler unit tests |
| Modify | `packages/db/src/schema/index.ts` | Export new schema, remove old |
| Modify | `packages/db/src/index.ts` | Remove old caddy exports (schema-only package) |
| Modify | `packages/shared/src/id.ts` | Add `proxyRoute` prefix |
| Modify | `packages/env/src/server.ts` | Remove unused Caddy env vars |
| Modify | `packages/api/src/routers/project/contract.ts` | Update caddy schemas |
| Modify | `packages/api/src/routers/project/service.ts` | Use proxy_route + reconciler |
| Modify | `packages/api/src/routers/project/index.ts` | Update caddy route handlers |
| Modify | `docker-compose.yml` | Uncomment Caddy service |
| Modify | `infra/caddy/config/Caddyfile` | Seed Caddyfile for startup |
| Delete | `packages/api/src/caddy/config.ts` | Old Caddyfile builder |
| Delete | `packages/api/src/caddy/service.ts` | Old Caddy service |
| Delete | `packages/api/src/caddy/__tests__/config.test.ts` | Old tests |
| Delete | `packages/db/src/schema/caddy.ts` | Old caddy_config schema |
| Delete | `packages/db/src/caddy.ts` | Old caddy CRUD (queries should never have been here) |

---

### Task 1: Add `proxyRoute` ID prefix

**Files:**
- Modify: `packages/shared/src/id.ts:20-31`

- [ ] **Step 1: Add the prefix to ID_PREFIX**

In `packages/shared/src/id.ts`, add `proxyRoute` to the `ID_PREFIX` object:

```ts
export const ID_PREFIX = {
  // auth
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",

  project: "project",
  resource: "resource",
  environment: "environment",
  proxyRoute: "proxy_route",
} as const;
```

This removes the old `caddyConfig` prefix and adds `proxyRoute`.

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/id.ts
git commit -m "feat: add proxyRoute ID prefix, remove caddyConfig"
```

---

### Task 2: Create `proxy_route` DB schema

**Files:**
- Create: `packages/db/src/schema/proxy-route.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Create `packages/db/src/schema/proxy-route.ts`:

```ts
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { project } from "./project";

export const proxyRouteTypeEnum = pgEnum("proxy_route_type", ["http", "layer4"]);
export const proxyRouteProtocolEnum = pgEnum("proxy_route_protocol", ["tcp", "http"]);

export const proxyRoute = pgTable(
  "proxy_route",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId(ID_PREFIX.proxyRoute)),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    resourceId: text("resource_id"),
    type: proxyRouteTypeEnum("type").notNull(),
    domain: text("domain").notNull(),
    upstreamHost: text("upstream_host").notNull(),
    upstreamPort: integer("upstream_port").notNull(),
    protocol: proxyRouteProtocolEnum("protocol").notNull(),
    layer4Alpn: text("layer4_alpn"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("proxy_route_domain_unique").on(table.domain),
    index("proxy_route_project_id_idx").on(table.projectId),
    index("proxy_route_resource_id_idx").on(table.resourceId),
  ],
);
```

- [ ] **Step 2: Update schema index**

Replace `packages/db/src/schema/index.ts` contents:

```ts
export * from "./auth";
export * from "./project";
export * from "./proxy-route";
```

This removes the `caddy` schema export.

- [ ] **Step 3: Push schema to database**

Run: `bun db:push`

Expected: Schema applied, `proxy_route` table created. The old `caddy_config` table remains in DB but is no longer referenced by code.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/proxy-route.ts packages/db/src/schema/index.ts
git commit -m "feat: add proxy_route schema, remove caddy_config from exports"
```

---

### Task 3: Create `proxy_route` CRUD queries in API package

**Files:**
- Create: `packages/api/src/caddy/queries.ts`
- Modify: `packages/db/src/index.ts`

Queries live in the API package, not the DB package. The DB package only exports schema + client.

- [ ] **Step 1: Create the query file**

Create `packages/api/src/caddy/queries.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";

export type ProxyRouteRecord = InferSelectModel<typeof proxyRoute>;

export async function listEnabledProxyRoutes(): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.enabled, true))
    .orderBy(asc(proxyRoute.projectId), asc(proxyRoute.domain));
}

export async function listProxyRoutesByProject(projectId: string): Promise<ProxyRouteRecord[]> {
  return db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.projectId, projectId))
    .orderBy(asc(proxyRoute.domain));
}

export async function getProxyRouteByDomain(domain: string): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.domain, domain))
    .limit(1);
  return record;
}

export async function getProxyRouteByResourceId(resourceId: string): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .select()
    .from(proxyRoute)
    .where(eq(proxyRoute.resourceId, resourceId))
    .limit(1);
  return record;
}

export async function insertProxyRoute(input: {
  projectId: string;
  resourceId?: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn?: string;
}): Promise<ProxyRouteRecord> {
  const [record] = await db
    .insert(proxyRoute)
    .values({
      projectId: input.projectId,
      resourceId: input.resourceId ?? null,
      type: input.type,
      domain: input.domain,
      upstreamHost: input.upstreamHost,
      upstreamPort: input.upstreamPort,
      protocol: input.protocol,
      layer4Alpn: input.layer4Alpn ?? null,
    })
    .returning();

  if (!record) {
    throw new Error("Failed to insert proxy route.");
  }

  return record;
}

export async function updateProxyRoute(
  id: string,
  input: Partial<{
    upstreamHost: string;
    upstreamPort: number;
    enabled: boolean;
  }>,
): Promise<ProxyRouteRecord | undefined> {
  const [record] = await db
    .update(proxyRoute)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(proxyRoute.id, id))
    .returning();

  return record;
}

export async function deleteProxyRoute(id: string): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.id, id));
}

export async function deleteProxyRoutesByResource(resourceId: string): Promise<void> {
  await db.delete(proxyRoute).where(eq(proxyRoute.resourceId, resourceId));
}
```

- [ ] **Step 2: Update db index to remove old caddy exports**

Replace `packages/db/src/index.ts` contents:

```ts
export { db } from "./client";
export * from "./project";
export * from "./project-resource";
```

This removes the `caddy` export. No proxy-route queries here — they live in the API package.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/caddy/queries.ts packages/db/src/index.ts
git commit -m "feat: add proxy_route CRUD queries in API package"
```

---

### Task 4: Create the Caddyfile builder with tests (TDD)

**Files:**
- Create: `packages/api/src/caddy/__tests__/builder.test.ts`
- Create: `packages/api/src/caddy/builder.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/caddy/__tests__/builder.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  buildCaddyfile,
  buildGlobalBlock,
  buildHttpBlock,
  buildLayer4Route,
  sanitizeMatcherName,
  type ProxyRouteInput,
} from "../builder";

describe("builder", () => {
  const httpRoute: ProxyRouteInput = {
    projectId: "project_abc",
    type: "http",
    domain: "myapp-acme.otterdeploy.dev",
    upstreamHost: "myapp.acme.otterdeploy.internal",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
  };

  const layer4Route: ProxyRouteInput = {
    projectId: "project_abc",
    type: "layer4",
    domain: "primary-acme.db.otterdeploy.dev",
    upstreamHost: "primary-acme.otterdeploy.internal",
    upstreamPort: 5432,
    protocol: "tcp",
    layer4Alpn: "postgresql",
  };

  test("sanitizeMatcherName converts domain to safe identifier", () => {
    expect(sanitizeMatcherName("primary-acme.db.otterdeploy.dev")).toBe(
      "primary_acme_db_otterdeploy_dev",
    );
  });

  test("buildHttpBlock produces a site block with reverse_proxy", () => {
    const output = buildHttpBlock(httpRoute);
    expect(output).toBe(
      [
        "myapp-acme.otterdeploy.dev {",
        "\treverse_proxy myapp.acme.otterdeploy.internal:3000",
        "}",
      ].join("\n"),
    );
  });

  test("buildLayer4Route produces matcher and route block", () => {
    const output = buildLayer4Route(layer4Route);
    expect(output).toContain("@pg_primary_acme_db_otterdeploy_dev tls {");
    expect(output).toContain("alpn postgresql");
    expect(output).toContain("sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("proxy primary-acme.otterdeploy.internal:5432");
  });

  test("buildGlobalBlock includes layer4 routes in listener_wrappers", () => {
    const output = buildGlobalBlock([layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("listener_wrappers {");
    expect(output).toContain("layer4 {");
    expect(output).toContain("sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("tls\n");
  });

  test("buildGlobalBlock omits listener_wrappers when no layer4 routes", () => {
    const output = buildGlobalBlock([], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).not.toContain("listener_wrappers");
    expect(output).not.toContain("layer4");
  });

  test("buildCaddyfile assembles global block + http blocks", () => {
    const output = buildCaddyfile([httpRoute, layer4Route], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("myapp-acme.otterdeploy.dev {");
    expect(output).toContain("reverse_proxy myapp.acme.otterdeploy.internal:3000");
    expect(output).toContain("sni primary-acme.db.otterdeploy.dev");
    expect(output).toContain("proxy primary-acme.otterdeploy.internal:5432");
  });

  test("buildCaddyfile with only http routes omits layer4", () => {
    const output = buildCaddyfile([httpRoute], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).toContain("myapp-acme.otterdeploy.dev {");
    expect(output).not.toContain("layer4");
  });

  test("buildCaddyfile with empty routes produces minimal global block", () => {
    const output = buildCaddyfile([], "0.0.0.0:2019");
    expect(output).toContain("admin 0.0.0.0:2019");
    expect(output).not.toContain("reverse_proxy");
    expect(output).not.toContain("layer4");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun test packages/api/src/caddy/__tests__/builder.test.ts`

Expected: FAIL — module `../builder` not found.

- [ ] **Step 3: Implement the builder**

Create `packages/api/src/caddy/builder.ts`:

```ts
export type ProxyRouteInput = {
  projectId: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
};

export function sanitizeMatcherName(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function buildHttpBlock(route: ProxyRouteInput): string {
  return [
    `${route.domain} {`,
    `\treverse_proxy ${route.upstreamHost}:${route.upstreamPort}`,
    "}",
  ].join("\n");
}

export function buildLayer4Route(route: ProxyRouteInput): string {
  const matcherName = `pg_${sanitizeMatcherName(route.domain)}`;
  const alpn = route.layer4Alpn ?? "postgresql";

  return [
    `@${matcherName} tls {`,
    `\talpn ${alpn}`,
    `\tsni ${route.domain}`,
    "}",
    `route @${matcherName} {`,
    "\ttls {",
    "\t\tconnection_policy {",
    `\t\t\talpn ${alpn}`,
    "\t\t}",
    "\t}",
    `\tproxy ${route.upstreamHost}:${route.upstreamPort}`,
    "}",
  ].join("\n");
}

export function buildGlobalBlock(layer4Routes: ProxyRouteInput[], adminBind: string): string {
  const lines = ["{", `\tadmin ${adminBind}`];

  if (layer4Routes.length > 0) {
    lines.push("\tservers {");
    lines.push("\t\tlistener_wrappers {");
    lines.push("\t\t\tlayer4 {");
    for (const route of layer4Routes) {
      const routeLines = buildLayer4Route(route).split("\n");
      for (const line of routeLines) {
        lines.push(`\t\t\t\t${line}`);
      }
    }
    lines.push("\t\t\t}");
    lines.push("\t\t\ttls");
    lines.push("\t\t}");
    lines.push("\t}");
  }

  lines.push("}");
  return lines.join("\n");
}

export function buildCaddyfile(routes: ProxyRouteInput[], adminBind: string): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  const sections: string[] = [buildGlobalBlock(layer4Routes, adminBind)];

  for (const route of httpRoutes) {
    sections.push(buildHttpBlock(route));
  }

  return sections.join("\n\n") + "\n";
}

export function buildProjectFragment(routes: ProxyRouteInput[]): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  const sections: string[] = [];

  for (const route of httpRoutes) {
    sections.push(buildHttpBlock(route));
  }

  for (const route of layer4Routes) {
    sections.push(buildLayer4Route(route));
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun test packages/api/src/caddy/__tests__/builder.test.ts`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/caddy/__tests__/builder.test.ts packages/api/src/caddy/builder.ts
git commit -m "feat: add Caddyfile builder with tests"
```

---

### Task 5: Create the Caddy admin API client

**Files:**
- Create: `packages/api/src/caddy/client.ts`

- [ ] **Step 1: Create the client**

Create `packages/api/src/caddy/client.ts`:

```ts
export type AdaptResult =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

export type LoadResult =
  | { ok: true }
  | { ok: false; error: string };

export async function adaptCaddyfile(caddyfile: string, adminUrl: string): Promise<AdaptResult> {
  try {
    const response = await fetch(new URL("/adapt", adminUrl), {
      method: "POST",
      headers: { "Content-Type": "text/caddyfile" },
      body: caddyfile,
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: text };
    }

    const json = await response.json();
    return { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy adapt request failed",
    };
  }
}

export async function loadCaddyfile(caddyfile: string, adminUrl: string): Promise<LoadResult> {
  try {
    const response = await fetch(new URL("/load", adminUrl), {
      method: "POST",
      headers: {
        "Content-Type": "text/caddyfile",
        "Cache-Control": "must-revalidate",
      },
      body: caddyfile,
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: text };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Caddy load request failed",
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/caddy/client.ts
git commit -m "feat: add Caddy admin API client"
```

---

### Task 6: Create the reconciler with tests (TDD)

**Files:**
- Create: `packages/api/src/caddy/__tests__/reconciler.test.ts`
- Create: `packages/api/src/caddy/reconciler.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/caddy/__tests__/reconciler.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test";

import { reconcileRoutes, type ReconcileResult } from "../reconciler";
import type { ProxyRouteInput } from "../builder";

describe("reconciler", () => {
  const httpRoute: ProxyRouteInput = {
    projectId: "project_abc",
    type: "http",
    domain: "myapp.otterdeploy.dev",
    upstreamHost: "myapp.otterdeploy.internal",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
  };

  const layer4Route: ProxyRouteInput = {
    projectId: "project_xyz",
    type: "layer4",
    domain: "db.otterdeploy.dev",
    upstreamHost: "db.otterdeploy.internal",
    upstreamPort: 5432,
    protocol: "tcp",
    layer4Alpn: "postgresql",
  };

  test("applies all routes when all projects validate", async () => {
    const adaptFn = mock(() => Promise.resolve({ ok: true as const, json: {} }));
    const loadFn = mock(() => Promise.resolve({ ok: true as const }));

    const result = await reconcileRoutes({
      routes: [httpRoute, layer4Route],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual(["project_abc", "project_xyz"]);
    expect(result.skipped).toEqual([]);
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  test("skips a project whose fragment fails validation", async () => {
    const adaptFn = mock((caddyfile: string) => {
      if (caddyfile.includes("myapp.otterdeploy.dev")) {
        return Promise.resolve({ ok: false as const, error: "bad config" });
      }
      return Promise.resolve({ ok: true as const, json: {} });
    });
    const loadFn = mock(() => Promise.resolve({ ok: true as const }));

    const result = await reconcileRoutes({
      routes: [httpRoute, layer4Route],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual(["project_xyz"]);
    expect(result.skipped).toEqual([
      { projectId: "project_abc", error: "bad config" },
    ]);
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  test("returns empty applied when load fails", async () => {
    const adaptFn = mock(() => Promise.resolve({ ok: true as const, json: {} }));
    const loadFn = mock(() =>
      Promise.resolve({ ok: false as const, error: "caddy down" }),
    );

    const result = await reconcileRoutes({
      routes: [httpRoute],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual([]);
    expect(result.loadError).toBe("caddy down");
  });

  test("handles empty routes", async () => {
    const adaptFn = mock(() => Promise.resolve({ ok: true as const, json: {} }));
    const loadFn = mock(() => Promise.resolve({ ok: true as const }));

    const result = await reconcileRoutes({
      routes: [],
      adminBind: "0.0.0.0:2019",
      adapt: adaptFn,
      load: loadFn,
    });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(loadFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun test packages/api/src/caddy/__tests__/reconciler.test.ts`

Expected: FAIL — module `../reconciler` not found.

- [ ] **Step 3: Implement the reconciler**

Create `packages/api/src/caddy/reconciler.ts`:

```ts
import { createHash } from "node:crypto";

import {
  buildCaddyfile,
  buildProjectFragment,
  type ProxyRouteInput,
} from "./builder";
import type { AdaptResult, LoadResult } from "./client";

export type ReconcileResult = {
  applied: string[];
  skipped: { projectId: string; error: string }[];
  revision: string;
  loadError?: string;
};

type ReconcileOptions = {
  routes: ProxyRouteInput[];
  adminBind: string;
  adapt: (caddyfile: string) => Promise<AdaptResult>;
  load: (caddyfile: string) => Promise<LoadResult>;
};

export async function reconcileRoutes(options: ReconcileOptions): Promise<ReconcileResult> {
  const { routes, adminBind, adapt, load } = options;

  const byProject = groupByProject(routes);

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [];
  const validRoutes: ProxyRouteInput[] = [];

  for (const [projectId, projectRoutes] of byProject) {
    const fragment = buildProjectFragment(projectRoutes);
    if (!fragment.trim()) {
      applied.push(projectId);
      continue;
    }

    const wrappedFragment = wrapForValidation(fragment);
    const result = await adapt(wrappedFragment);

    if (result.ok) {
      validRoutes.push(...projectRoutes);
      applied.push(projectId);
    } else {
      skipped.push({ projectId, error: result.error });
    }
  }

  const caddyfile = buildCaddyfile(validRoutes, adminBind);
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);

  const loadResult = await load(caddyfile);

  if (!loadResult.ok) {
    return {
      applied: [],
      skipped,
      revision,
      loadError: loadResult.error,
    };
  }

  return { applied, skipped, revision };
}

function groupByProject(routes: ProxyRouteInput[]): Map<string, ProxyRouteInput[]> {
  const map = new Map<string, ProxyRouteInput[]>();
  for (const route of routes) {
    const existing = map.get(route.projectId);
    if (existing) {
      existing.push(route);
    } else {
      map.set(route.projectId, [route]);
    }
  }
  return map;
}

function wrapForValidation(fragment: string): string {
  return `${fragment.trim()}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun test packages/api/src/caddy/__tests__/reconciler.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/caddy/__tests__/reconciler.test.ts packages/api/src/caddy/reconciler.ts
git commit -m "feat: add Caddy reconciler with per-project validation"
```

---

### Task 7: Create the `reconcile()` entry point

This wires the reconciler to the DB and Caddy client. It's the function that `service.ts` and startup code will call.

**Files:**
- Create: `packages/api/src/caddy/index.ts`

- [ ] **Step 1: Create the entry point**

Create `packages/api/src/caddy/index.ts`:

```ts
import { env } from "@otterdeploy/env/server";

import type { ProxyRouteInput } from "./builder";
import { adaptCaddyfile, loadCaddyfile } from "./client";
import { listEnabledProxyRoutes } from "./queries";
import { reconcileRoutes, type ReconcileResult } from "./reconciler";

export type { ReconcileResult } from "./reconciler";
export type { ProxyRouteInput } from "./builder";

export async function reconcile(): Promise<ReconcileResult> {
  const records = await listEnabledProxyRoutes();

  const routes: ProxyRouteInput[] = records.map((r) => ({
    projectId: r.projectId,
    type: r.type,
    domain: r.domain,
    upstreamHost: r.upstreamHost,
    upstreamPort: r.upstreamPort,
    protocol: r.protocol,
    layer4Alpn: r.layer4Alpn,
  }));

  return reconcileRoutes({
    routes,
    adminBind: env.CADDY_ADMIN_BIND,
    adapt: (caddyfile) => adaptCaddyfile(caddyfile, env.CADDY_ADMIN_URL),
    load: (caddyfile) => loadCaddyfile(caddyfile, env.CADDY_ADMIN_URL),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/caddy/index.ts
git commit -m "feat: add reconcile() entry point wiring DB + Caddy client"
```

---

### Task 8: Remove unused Caddy env vars

**Files:**
- Modify: `packages/env/src/server.ts`

- [ ] **Step 1: Remove unused env vars**

In `packages/env/src/server.ts`, remove these lines from the `server` object:

- `CADDY_CONFIG_DIR`
- `CADDY_RUNTIME_CONFIG_DIR`
- `CADDY_RESERVED_HOSTS`
- `CADDY_RESERVED_LAYER4_PORTS`

Keep `CADDY_ADMIN_URL` and `CADDY_ADMIN_BIND`.

The resulting caddy-related env vars should be:

```ts
CADDY_ADMIN_URL: z.url().default("http://127.0.0.1:2019"),
CADDY_ADMIN_BIND: z.string().min(1).default("0.0.0.0:2019"),
```

Note: Change `CADDY_ADMIN_BIND` default from `127.0.0.1:2019` to `0.0.0.0:2019` so Caddy's admin API is accessible from the host when running in Docker.

- [ ] **Step 2: Commit**

```bash
git add packages/env/src/server.ts
git commit -m "chore: remove unused Caddy env vars"
```

---

### Task 9: Update project router contracts

**Files:**
- Modify: `packages/api/src/routers/project/contract.ts`

- [ ] **Step 1: Replace caddy config schemas with reconcile result**

In `packages/api/src/routers/project/contract.ts`:

Remove these schemas:
- `projectCaddyConfigSchema`
- `getProjectCaddyConfigInput`
- `saveProjectCaddyConfigInput`
- `saveProjectCaddyConfigOutput`

Add this schema:

```ts
export const reconcileResultSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(
    z.object({
      projectId: z.string(),
      error: z.string(),
    }),
  ),
  revision: z.string(),
  loadError: z.string().optional(),
});
```

Remove the `caddy` property from `projectContract` and add a `proxyRoute` section:

```ts
export const proxyRouteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  resourceId: z.string().nullable(),
  type: z.enum(["http", "layer4"]),
  domain: z.string(),
  upstreamHost: z.string(),
  upstreamPort: z.number().int().positive(),
  protocol: z.enum(["tcp", "http"]),
  layer4Alpn: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listProxyRoutesInput = z.object({
  projectId: z.string().min(1),
});
```

Replace the `caddy` contract in `projectContract` with:

```ts
proxyRoute: {
  list: oc
    .errors({
      NOT_FOUND: {
        status: 404,
        message: "Project not found" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/proxy-routes`,
      tag,
      method: "GET",
    })
    .input(listProxyRoutesInput)
    .output(z.array(proxyRouteSchema)),
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routers/project/contract.ts
git commit -m "feat: replace caddy config contracts with proxy route contracts"
```

---

### Task 10: Update project service to use proxy_route + reconciler

**Files:**
- Modify: `packages/api/src/routers/project/service.ts`

- [ ] **Step 1: Replace caddy imports and update createPostgresResource**

In `packages/api/src/routers/project/service.ts`:

Replace the caddy imports at the top:

```ts
// REMOVE these:
import { buildPostgresLayer4Snippet, sanitizeProjectSlug } from "../../caddy/config";
import { getProjectCaddyConfig, saveProjectCaddyConfig } from "../../caddy/service";

// ADD these:
import { reconcile } from "../../caddy";
import { insertProxyRoute, getProxyRouteByResourceId, updateProxyRoute } from "../../caddy/queries";
```

Keep `sanitizeProjectSlug` — extract it inline since we're deleting `config.ts`:

```ts
function sanitizeProjectSlug(projectId: string): string {
  const value = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "project";
}
```

Update `createPostgresResource` — replace the caddy snippet + `attachDatabaseIngress` section (lines ~175-213) with:

```ts
  // After creating the database resource record and before the return:
  
  await insertProxyRoute({
    projectId: input.projectId,
    resourceId: created.resource.id,
    type: "layer4",
    domain: publicHostname,
    upstreamHost: internalHostname,
    upstreamPort: env.DATABASE_INTERNAL_PORT,
    protocol: "tcp",
    layer4Alpn: "postgresql",
  });

  const reconcileResult = await reconcile();
  const isApplied = reconcileResult.applied.includes(input.projectId);

  await updateDatabaseResourceStatus(created.resource.id, isApplied ? "valid" : "invalid");
```

Remove the `caddyLayer4Snippet` from `createDatabaseResourceRecord` call — but keep it in the record for now since the DB column still exists. Pass an empty string:

```ts
caddyLayer4Snippet: "",
```

Remove the `PostgresResourceView.caddyLayer4Snippet` field and replace it in `mapDatabaseResource`.

Remove the `attachDatabaseIngress`, `appendManagedLayer4Snippet`, and `replaceManagedLayer4Snippet` functions entirely.

Update `ensureDockerRuntimeForRecord` to use proxy_route instead of caddy config:

```ts
async function ensureDockerRuntimeForRecord(
  record: DatabaseResourceRecord,
  projectSlug: string,
): Promise<{ record: DatabaseResourceRecord; runtime: DockerPostgresRuntime }> {
  const containerName = buildContainerName({ projectSlug, resourceName: record.resource.name });
  const volumeName = buildVolumeName({ projectSlug, resourceName: record.resource.name });
  const existingRuntime = await inspectDockerPostgresRuntime({ containerName, volumeName });

  if (existingRuntime.status !== "missing") {
    return { record, runtime: existingRuntime };
  }

  const runtime = await provisionDockerPostgres({
    containerName,
    volumeName,
    hostnameAlias: record.database.internalHostname,
    databaseName: record.database.databaseName,
    username: record.database.username,
    password: record.database.password,
  });

  if (runtime.hostPort === null) {
    return { record, runtime };
  }

  // Update proxy route if upstream changed
  const existingRoute = await getProxyRouteByResourceId(record.resource.id);
  if (existingRoute) {
    await updateProxyRoute(existingRoute.id, {
      upstreamHost: record.database.internalHostname,
      upstreamPort: env.DATABASE_INTERNAL_PORT,
    });
  }

  await updateDatabaseResourceRuntime({
    resourceId: record.resource.id,
    upstreamHost: record.database.internalHostname,
    upstreamPort: env.DATABASE_INTERNAL_PORT,
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
        upstreamPort: env.DATABASE_INTERNAL_PORT,
        caddyLayer4Snippet: "",
      },
    },
    runtime,
  };
}
```

Add a new `listProxyRoutes` function for the router:

```ts
import { listProxyRoutesByProject, type ProxyRouteRecord } from "../../caddy/queries";

export type ProxyRouteView = {
  id: string;
  projectId: string;
  resourceId: string | null;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ListProxyRoutesResult =
  | { ok: true; routes: ProxyRouteView[] }
  | { ok: false; reason: "project_not_found" };

export async function listProjectProxyRoutes(input: {
  projectId: string;
}): Promise<ListProxyRoutesResult> {
  const project = await getProjectRecord(input.projectId);
  if (!project) {
    return { ok: false, reason: "project_not_found" };
  }

  const records = await listProxyRoutesByProject(input.projectId);

  return {
    ok: true,
    routes: records.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      resourceId: r.resourceId,
      type: r.type,
      domain: r.domain,
      upstreamHost: r.upstreamHost,
      upstreamPort: r.upstreamPort,
      protocol: r.protocol,
      layer4Alpn: r.layer4Alpn,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routers/project/service.ts
git commit -m "feat: switch project service from caddy config to proxy_route + reconciler"
```

---

### Task 11: Update project router handlers

**Files:**
- Modify: `packages/api/src/routers/project/index.ts`

- [ ] **Step 1: Replace caddy handlers with proxyRoute handlers**

Replace `packages/api/src/routers/project/index.ts`:

```ts
import { publicProcedure } from "../..";

import {
  createProject,
  createPostgresResource,
  getProject,
  getPostgresResource,
  listProjects,
  listPostgresResources,
  listProjectProxyRoutes,
} from "./service";

export const projectRouter = {
  get: publicProcedure.project.get.handler(async ({ input, errors }) => {
    const result = await getProject(input);
    if (!result.ok) {
      throw errors.NOT_FOUND();
    }
    return result.project;
  }),
  list: publicProcedure.project.list.handler(async () => {
    return listProjects();
  }),
  create: publicProcedure.project.create.handler(async ({ input, errors }) => {
    const result = await createProject(input);
    if (!result.ok) {
      throw errors.CONFLICT();
    }
    return result.project;
  }),
  proxyRoute: {
    list: publicProcedure.project.proxyRoute.list.handler(async ({ input, errors }) => {
      const result = await listProjectProxyRoutes(input);
      if (!result.ok) {
        throw errors.NOT_FOUND();
      }
      return result.routes;
    }),
  },
  database: {
    createPostgres: publicProcedure.project.database.createPostgres.handler(
      async ({ input, errors }) => {
        const result = await createPostgresResource(input);
        if (!result.ok) {
          if (result.reason === "project_not_found") {
            throw errors.NOT_FOUND();
          }
          throw errors.CONFLICT();
        }
        return result.resource;
      },
    ),
    listPostgres: publicProcedure.project.database.listPostgres.handler(
      async ({ input, errors }) => {
        const result = await listPostgresResources(input);
        if (!result.ok) {
          throw errors.NOT_FOUND();
        }
        return result.resources;
      },
    ),
    getPostgres: publicProcedure.project.database.getPostgres.handler(async ({ input, errors }) => {
      const result = await getPostgresResource(input);
      if (!result.ok) {
        throw errors.NOT_FOUND();
      }
      return result.resource;
    }),
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routers/project/index.ts
git commit -m "feat: replace caddy route handlers with proxyRoute handlers"
```

---

### Task 12: Delete old Caddy files

**Files:**
- Delete: `packages/api/src/caddy/config.ts`
- Delete: `packages/api/src/caddy/service.ts`
- Delete: `packages/api/src/caddy/__tests__/config.test.ts`
- Delete: `packages/db/src/schema/caddy.ts`
- Delete: `packages/db/src/caddy.ts`

- [ ] **Step 1: Delete all old caddy files**

```bash
rm packages/api/src/caddy/config.ts
rm packages/api/src/caddy/service.ts
rm packages/api/src/caddy/__tests__/config.test.ts
rm packages/db/src/schema/caddy.ts
rm packages/db/src/caddy.ts
```

- [ ] **Step 2: Verify no remaining imports reference deleted files**

Run: `grep -r "caddy/config" packages/api/src/ packages/db/src/ --include="*.ts" | grep -v node_modules | grep -v __tests__/builder | grep -v __tests__/reconciler`

Expected: No output (no remaining references).

Run: `grep -r "caddy/service" packages/api/src/ packages/db/src/ --include="*.ts" | grep -v node_modules`

Expected: No output.

Run: `grep -r "from.*@otterdeploy/db.*caddy" packages/ --include="*.ts" | grep -v node_modules`

Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add -u packages/api/src/caddy/config.ts packages/api/src/caddy/service.ts packages/api/src/caddy/__tests__/config.test.ts packages/db/src/schema/caddy.ts packages/db/src/caddy.ts
git commit -m "chore: delete old Caddy config, service, and schema files"
```

---

### Task 13: Uncomment Caddy in docker-compose and update seed Caddyfile

**Files:**
- Modify: `docker-compose.yml`
- Modify: `infra/caddy/config/Caddyfile`

- [ ] **Step 1: Uncomment Caddy service in docker-compose.yml**

Replace the commented-out caddy block and volumes/networks with:

```yaml
  caddy:
    build:
      context: .
      dockerfile: ./infra/caddy/Dockerfile
    container_name: otterdeploy-caddy
    restart: unless-stopped
    command: sh -c "caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
      - "127.0.0.1:2019:2019"
    volumes:
      - ./infra/caddy/config:/etc/caddy
      - otterdeploy-caddy-data:/data
      - otterdeploy-caddy-state:/config
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks:
      - default
      - otterdeploy-resources
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:2019/config/",
        ]
      interval: 10s
      timeout: 3s
      retries: 5
```

Uncomment the volumes:

```yaml
volumes:
  otterdeploy-postgres-data:
  otterdeploy-caddy-data:
  otterdeploy-caddy-state:
```

Note: Removed `--resume` flag from the command. Config is rebuilt from DB by the reconciler on server start.

- [ ] **Step 2: Update seed Caddyfile**

Replace `infra/caddy/config/Caddyfile`:

```caddyfile
{
	admin 0.0.0.0:2019
}
```

This is the minimal seed. The reconciler will overwrite it via `/load` on first reconcile. Removed `local_certs` since we're using ACME.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml infra/caddy/config/Caddyfile
git commit -m "feat: uncomment Caddy in docker-compose, update seed Caddyfile"
```

---

### Task 14: Run all tests and verify build

- [ ] **Step 1: Run all caddy tests**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun test packages/api/src/caddy/`

Expected: All tests in `builder.test.ts` and `reconciler.test.ts` pass.

- [ ] **Step 2: Type check**

Run: `cd /Users/jeffersonchukwuka/Developer/playground/otterdeploy && bun run build` (or `bunx tsc --noEmit` if build isn't configured)

Expected: No type errors.

- [ ] **Step 3: Fix any remaining issues and commit**

If any type errors or test failures, fix them and commit the fixes.
