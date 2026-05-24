# Resource Model Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the engine-specific `project.database.postgres.*` API with a polymorphic `project.resource.*` API that returns a discriminated union, so adding MySQL/Mongo/Redis/ClickHouse later becomes a localized change instead of a parallel router clone.

**Architecture:** The DB schema is already polymorphic (`resource` parent table with `type` discriminator, `database_resource` / `service_resource` extensions). This refactor aligns the API surface, the provisioner layer, and the frontend collection to match. Generic read/delete endpoints return a discriminated union (`type` × `engine`); creates stay engine-specific because their inputs differ. One `DatabaseProvisioner` interface gates all engine-specific side effects; only `PostgresProvisioner` exists for now but the seam is set.

**Tech Stack:** Drizzle (Postgres jsonb column), oRPC + Zod discriminated unions, `better-result` for handler errors, TanStack DB collections on the frontend, Bun test runner.

---

## File Structure

**New files:**
- `packages/shared/src/database-engines.ts` — static engine catalog
- `packages/api/src/routers/project/resources.ts` — generic resource handlers (list/get/delete)
- `packages/api/src/routers/project/queries/resource.ts` — generic resource queries
- `packages/api/src/routers/project/provisioners/index.ts` — `DatabaseProvisioner` interface + factory
- `packages/api/src/routers/project/provisioners/postgres.ts` — postgres impl
- `packages/api/src/routers/project/__tests__/resources.test.ts` — handler unit tests
- `packages/api/src/routers/project/provisioners/__tests__/factory.test.ts` — factory dispatch test
- `apps/web/src/features/projects/data/resource.ts` — frontend `resourceCollection`

**Modified files:**
- `packages/db/src/schema/project.ts` — add `engineConfig` jsonb to `database_resource`
- `packages/api/src/routers/project/contract.ts` — add `databaseResourceSchema` (engine union), `resourceSchema` (type union), new resource endpoints, drop old database.postgres.{list,get,delete}
- `packages/api/src/routers/project/postgres.ts` — pare down to `createPostgresResource` only; destroy moves to provisioner
- `packages/api/src/routers/project/handlers.ts` — re-export new resource handlers, drop old
- `packages/api/src/routers/project/index.ts` — wire new `resource.*` namespace, remove old `database.postgres.{list,get,delete}`
- `packages/api/src/routers/project/queries/index.ts` — re-export generic resource queries
- `apps/web/src/routes/_app/$orgSlug/$projectSlug/layout.tsx` — preload `resourceCollection`, derive counts
- `apps/web/src/features/projects/components/project-card.tsx` — pull `databaseCount` from `project.list` aggregate

**Out of scope:** `apps/web-demo/**` is dead code — type errors there from the contract rename are tolerated.

---

## Task 1: Add `engineConfig` jsonb column to `database_resource`

**Files:**
- Modify: `packages/db/src/schema/project.ts` (around line 131-169)

- [ ] **Step 1: Add the column to the Drizzle schema**

In `packages/db/src/schema/project.ts`, add the `jsonb` import and the column:

```ts
import {
  boolean,
  index,
  integer,
  jsonb,        // ← add this
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
```

Inside `databaseResource` (after `caddyLayer4Snippet`, before `createdAt`):

```ts
    caddyLayer4Snippet: text("caddy_layer4_snippet").notNull(),
    engineConfig: jsonb("engine_config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
```

- [ ] **Step 2: Push the schema to dev DB**

Run: `cd packages/db && bun db:push`
Expected: drizzle-kit reports the new column added; prompts confirmed; exits 0.

- [ ] **Step 3: Verify type compiles**

Run from repo root: `bun tsc --noEmit -p packages/db`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/project.ts
git commit -m "feat(db): add engine_config jsonb to database_resource"
```

---

## Task 2: Create the engine catalog

**Files:**
- Create: `packages/shared/src/database-engines.ts`
- Test: `packages/shared/src/__tests__/database-engines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/database-engines.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  DATABASE_ENGINES,
  getDatabaseEngine,
  type DatabaseEngine,
} from "../database-engines";

describe("DATABASE_ENGINES", () => {
  test("includes postgres", () => {
    expect(DATABASE_ENGINES.postgres).toBeDefined();
    expect(DATABASE_ENGINES.postgres.label).toBe("PostgreSQL");
    expect(DATABASE_ENGINES.postgres.defaultPort).toBe(5432);
  });

  test("getDatabaseEngine returns metadata for a known engine", () => {
    const meta = getDatabaseEngine("postgres" satisfies DatabaseEngine);
    expect(meta.dockerImage).toBe("postgres");
  });

  test("every engine has the required metadata shape", () => {
    for (const [key, meta] of Object.entries(DATABASE_ENGINES)) {
      expect(meta.label, `${key}.label`).toBeTypeOf("string");
      expect(meta.defaultPort, `${key}.defaultPort`).toBeTypeOf("number");
      expect(meta.dockerImage, `${key}.dockerImage`).toBeTypeOf("string");
      expect(Array.isArray(meta.versions), `${key}.versions is array`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && bun test src/__tests__/database-engines.test.ts`
Expected: FAIL with "Cannot find module '../database-engines'".

- [ ] **Step 3: Implement the catalog**

Create `packages/shared/src/database-engines.ts`:

```ts
export type DatabaseEngineMeta = {
  label: string;
  defaultPort: number;
  dockerImage: string;
  versions: ReadonlyArray<string>;
  category: "relational" | "document" | "key-value" | "analytical" | "search";
};

export const DATABASE_ENGINES = {
  postgres: {
    label: "PostgreSQL",
    defaultPort: 5432,
    dockerImage: "postgres",
    versions: ["16", "15", "14"] as const,
    category: "relational",
  },
} as const satisfies Record<string, DatabaseEngineMeta>;

export type DatabaseEngine = keyof typeof DATABASE_ENGINES;

export function getDatabaseEngine(engine: DatabaseEngine): DatabaseEngineMeta {
  return DATABASE_ENGINES[engine];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && bun test src/__tests__/database-engines.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database-engines.ts packages/shared/src/__tests__/database-engines.test.ts
git commit -m "feat(shared): add database engine catalog"
```

---

## Task 3: Add generic resource queries

**Files:**
- Create: `packages/api/src/routers/project/queries/resource.ts`
- Modify: `packages/api/src/routers/project/queries/index.ts`

- [ ] **Step 1: Implement generic resource queries**

Create `packages/api/src/routers/project/queries/resource.ts`:

```ts
import { and, eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import { databaseResource, resource } from "@otterstack/db/schema/project";

import type { ProjectId } from "../errors";
import type { ResourceId } from "../../service/errors";

export type DatabaseResourceJoined = {
  resource: typeof resource.$inferSelect;
  database: typeof databaseResource.$inferSelect;
};

/**
 * Fetch every resource attached to a project. Returns the parent `resource`
 * row plus its type-specific extension joined. New `type` discriminators must
 * be added here when their tables ship.
 */
export async function listProjectResources(projectId: ProjectId) {
  const databases = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(eq(resource.projectId, projectId));

  return { databases };
}

export async function getResourceById(
  projectId: ProjectId,
  resourceId: ResourceId,
): Promise<{ kind: "database"; record: DatabaseResourceJoined } | null> {
  const [dbRow] = await db
    .select({ resource, database: databaseResource })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .where(and(eq(resource.projectId, projectId), eq(resource.id, resourceId)))
    .limit(1);

  if (dbRow) return { kind: "database", record: dbRow };
  return null;
}

export async function deleteResourceById(resourceId: ResourceId) {
  await db.delete(resource).where(eq(resource.id, resourceId));
}
```

- [ ] **Step 2: Re-export from queries barrel**

Modify `packages/api/src/routers/project/queries/index.ts` — append before the final closing of the file (after the postgres-resource block):

```ts
export {
  deleteResourceById,
  getResourceById,
  listProjectResources,
  type DatabaseResourceJoined,
} from "./resource";
```

- [ ] **Step 3: Verify type compiles**

Run: `bun tsc --noEmit -p packages/api`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routers/project/queries/resource.ts packages/api/src/routers/project/queries/index.ts
git commit -m "feat(api): add generic resource queries"
```

---

## Task 4: Define the `DatabaseProvisioner` interface + factory

**Files:**
- Create: `packages/api/src/routers/project/provisioners/index.ts`
- Test: `packages/api/src/routers/project/provisioners/__tests__/factory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/routers/project/provisioners/__tests__/factory.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  getDatabaseProvisioner,
  type DatabaseProvisioner,
} from "../index";

describe("getDatabaseProvisioner", () => {
  test("returns the postgres provisioner for engine=postgres", () => {
    const provisioner = getDatabaseProvisioner("postgres");
    expect(provisioner.engine).toBe("postgres");
    expect(typeof provisioner.destroy).toBe("function");
    expect(typeof provisioner.inspectRuntime).toBe("function");
  });

  test("registered provisioners all implement the interface", () => {
    const provisioner: DatabaseProvisioner = getDatabaseProvisioner("postgres");
    expect(provisioner).toHaveProperty("provision");
    expect(provisioner).toHaveProperty("destroy");
    expect(provisioner).toHaveProperty("inspectRuntime");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/api && bun test src/routers/project/provisioners/__tests__/factory.test.ts`
Expected: FAIL with "Cannot find module '../index'".

- [ ] **Step 3: Implement the interface and factory (stub provisioner for now)**

Create `packages/api/src/routers/project/provisioners/index.ts`:

```ts
import type { RequestLogger } from "evlog";

import type { DatabaseEngine } from "@otterstack/shared/database-engines";

import type { ResourceId } from "../../service/errors";

export type ProvisionInput = {
  serviceName: string;
  volumeName: string;
  hostnameAlias: string;
  databaseName: string;
  username: string;
  password: string;
  projectSlug: string;
};

export type ProvisionRuntime = {
  serviceId: string | null;
  serviceName: string;
  volumeName: string;
  networkName: string;
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
};

export interface DatabaseProvisioner {
  readonly engine: DatabaseEngine;
  provision(input: ProvisionInput, log: RequestLogger): Promise<ProvisionRuntime>;
  destroy(input: { serviceName: string }, log: RequestLogger): Promise<void>;
  inspectRuntime(input: {
    serviceName: string;
    volumeName: string;
    projectSlug: string;
  }): Promise<ProvisionRuntime>;
}

import { postgresProvisioner } from "./postgres";

const PROVISIONERS: Record<DatabaseEngine, DatabaseProvisioner> = {
  postgres: postgresProvisioner,
};

export function getDatabaseProvisioner(engine: DatabaseEngine): DatabaseProvisioner {
  return PROVISIONERS[engine];
}
```

- [ ] **Step 4: Create the postgres provisioner that wraps existing swarm helpers**

Create `packages/api/src/routers/project/provisioners/postgres.ts`:

```ts
import {
  destroySwarmPostgres,
  inspectSwarmPostgresRuntime,
  provisionSwarmPostgres,
} from "../../../swarm";

import type { DatabaseProvisioner } from "./index";

export const postgresProvisioner: DatabaseProvisioner = {
  engine: "postgres",
  provision: (input, log) => provisionSwarmPostgres(input, log),
  destroy: ({ serviceName }, log) => destroySwarmPostgres({ serviceName }, log),
  inspectRuntime: (input) => inspectSwarmPostgresRuntime(input),
};
```

- [ ] **Step 5: Run the factory test**

Run: `cd packages/api && bun test src/routers/project/provisioners/__tests__/factory.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/project/provisioners/
git commit -m "feat(api): add DatabaseProvisioner interface with postgres impl"
```

---

## Task 5: Update contract — discriminated union + new resource endpoints

**Files:**
- Modify: `packages/api/src/routers/project/contract.ts`

- [ ] **Step 1: Add the discriminated union schemas**

In `packages/api/src/routers/project/contract.ts`, after the existing `postgresResourceSchema` definition (around line 49-76), add:

```ts
export const databaseResourceSchema = z.discriminatedUnion("engine", [
  postgresResourceSchema,
]);

export const resourceSchema = z.discriminatedUnion("type", [
  databaseResourceSchema.options[0], // postgres has `type: "database"`
]);

export const listProjectResourcesInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

export const getProjectResourceInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});

export const deleteProjectResourceInput = z.object({
  projectId: zId(ID_PREFIX.project),
  resourceId: zId(ID_PREFIX.resource),
});
```

Note: when `serviceResourceSchema` lands later, `resourceSchema` becomes `z.discriminatedUnion("type", [...databaseResourceSchema.options, serviceResourceSchema])`. The single-element shape today is intentional — it makes the type the same as it will be in the future.

- [ ] **Step 2: Add the new `resource` namespace to `projectContract`**

Still in `contract.ts`, inside the `projectContract` object, add a new `resource` block (place it after `proxyRoute`, before `database`):

```ts
  resource: {
    list: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Project not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources`,
        tag,
        method: "GET",
      })
      .input(listProjectResourcesInput)
      .output(z.array(resourceSchema)),

    get: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Resource not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}`,
        tag,
        method: "GET",
      })
      .input(getProjectResourceInput)
      .output(resourceSchema),

    delete: oc
      .errors({
        NOT_FOUND: {
          status: 404,
          message: "Resource not found" as const,
        },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}`,
        tag,
        method: "DELETE",
      })
      .input(deleteProjectResourceInput)
      .output(z.object({ ok: z.boolean() })),

    database: {
      postgres: {
        create: oc
          .errors({
            NOT_FOUND: {
              status: 404,
              message: "Project not found" as const,
            },
            CONFLICT: {
              status: 409,
              message: "Database resource already exists" as const,
            },
          })
          .meta({
            path: `${basePath}/{projectId}/resources/database/postgres`,
            tag,
            method: "POST",
          })
          .input(createPostgresDatabaseInput)
          .output(postgresResourceSchema),
      },
    },
  },
```

- [ ] **Step 3: Remove the old `database.postgres.{list,get,delete}` endpoints**

Still in `contract.ts`, delete the entire `database: { postgres: { ... } }` block (the old one — lines roughly 217-280 of the original file). The `createPostgresDatabaseInput` / `getPostgresDatabaseInput` / `deletePostgresDatabaseInput` / `listPostgresDatabasesInput` zod schemas at the top of the file can stay; the create input is still used by the new path, and the others become dead but cheap to keep — leave them.

The file should now have exactly one `database` mention left: the comment "// database" sitting above the createPostgresDatabaseInput. Update that comment to:

```ts
// Engine-specific create inputs (kept; reads/deletes are generic via resource.*)
```

- [ ] **Step 4: Verify type compiles**

Run: `bun tsc --noEmit -p packages/api`
Expected: errors about callers of removed endpoints (handlers.ts re-exports, index.ts router wiring, frontend callers). These get fixed in Tasks 6, 7, 8, 10.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/project/contract.ts
git commit -m "feat(api): add discriminated resource contract, drop engine-silo reads"
```

---

## Task 6: Generic resource handlers (list/get/delete)

**Files:**
- Create: `packages/api/src/routers/project/resources.ts`
- Test: `packages/api/src/routers/project/__tests__/resources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/routers/project/__tests__/resources.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test";

import type { Id, ID_PREFIX as IDP } from "@otterstack/shared/id";

// Subject-under-test imports
import {
  deleteProjectResource,
  getProjectResource,
  listProjectResources,
} from "../resources";

type ProjectId = Id<typeof IDP.project>;
type ResourceId = Id<typeof IDP.resource>;
type OrgId = Id<typeof IDP.organization>;

const projectId = "project_test" as ProjectId;
const resourceId = "resource_test" as ResourceId;
const organizationId = "org_test" as OrgId;

describe("listProjectResources", () => {
  test("returns NOT_FOUND error when project does not exist", async () => {
    mock.module("../queries", () => ({
      getProjectInOrg: async () => null,
      listProjectResources: async () => ({ databases: [] }),
    }));
    const result = await listProjectResources({ projectId, organizationId });
    expect(result.isErr()).toBe(true);
  });
});

describe("getProjectResource", () => {
  test("returns NOT_FOUND when project missing", async () => {
    mock.module("../queries", () => ({
      getProjectInOrg: async () => null,
      getResourceById: async () => null,
    }));
    const result = await getProjectResource({
      projectId,
      resourceId,
      organizationId,
    });
    expect(result.isErr()).toBe(true);
  });
});

describe("deleteProjectResource", () => {
  test("returns NOT_FOUND when resource missing", async () => {
    mock.module("../queries", () => ({
      getProjectInOrg: async () => ({ id: projectId, slug: "p" }),
      getResourceById: async () => null,
      deleteResourceById: async () => undefined,
    }));
    const log = { set: () => {} } as never;
    const result = await deleteProjectResource(
      { projectId, resourceId, organizationId },
      log,
    );
    expect(result.isErr()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/api && bun test src/routers/project/__tests__/resources.test.ts`
Expected: FAIL with "Cannot find module '../resources'".

- [ ] **Step 3: Implement the handlers**

Create `packages/api/src/routers/project/resources.ts`:

```ts
/**
 * Generic resource read/delete orchestration. Engine-specific create lives in
 * postgres.ts (and future siblings). Read/delete dispatch through the
 * DatabaseProvisioner factory so each engine plugs its own destroy semantics.
 */

import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import type { Id, ID_PREFIX as IDP } from "@otterstack/shared/id";

import { reconcile } from "../../caddy";
import { deleteProxyRoutesByResource } from "../../caddy/queries";

import {
  PostgresResourceNotFoundError,
  ProjectNotFoundError,
  type ProjectId,
} from "./errors";
import type { ResourceId } from "../service/errors";

import {
  deleteResourceById,
  getProjectInOrg,
  getResourceById,
  listProjectResources as listProjectResourcesQuery,
} from "./queries";
import { getDatabaseProvisioner } from "./provisioners";
import {
  buildContainerName,
  mapDatabaseResource,
  sanitizeProjectSlug,
  type PostgresResource,
} from "./views";

type OrgId = Id<typeof IDP.organization>;

type ProjectRef = {
  projectId: ProjectId;
  organizationId: OrgId;
};

type ResourceRef = ProjectRef & {
  resourceId: ResourceId;
};

export type ProjectResource = PostgresResource; // union grows with new engines

export async function listProjectResources(
  input: ProjectRef,
): Promise<Result<ProjectResource[], ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const { databases } = await listProjectResourcesQuery(input.projectId);
  const databaseViews = await Promise.all(
    databases.map((record) => mapDatabaseResource(record, project.slug)),
  );

  return Result.ok([...databaseViews]);
}

export async function getProjectResource(
  input: ResourceRef,
): Promise<Result<ProjectResource, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  // Today there's only `database`; switch on `kind` when more land.
  return Result.ok(await mapDatabaseResource(found.record, project.slug));
}

export async function deleteProjectResource(
  input: ResourceRef,
  log: RequestLogger,
): Promise<Result<{ ok: true }, PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    log.set({ resource: { outcome: "project_not_found" } });
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    log.set({ resource: { outcome: "resource_not_found" } });
    return Result.err(
      new PostgresResourceNotFoundError({ resourceId: input.resourceId }),
    );
  }

  if (found.kind === "database") {
    const provisioner = getDatabaseProvisioner(found.record.database.engine);
    const serviceName = buildContainerName({
      projectSlug: sanitizeProjectSlug(project.slug),
      resourceName: found.record.resource.name,
    });

    log.set({
      resource: {
        kind: found.record.database.engine,
        projectId: input.projectId,
        name: found.record.resource.name,
      },
    });

    await deleteProxyRoutesByResource(input.resourceId);
    await provisioner.destroy({ serviceName }, log);
    await deleteResourceById(input.resourceId);
    await reconcile(log);

    log.set({
      teardown: { proxyRoutesRemoved: true, swarmDestroyed: true, dbDeleted: true },
    });
  }

  return Result.ok({ ok: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/api && bun test src/routers/project/__tests__/resources.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/project/resources.ts packages/api/src/routers/project/__tests__/resources.test.ts
git commit -m "feat(api): add generic resource handlers (list/get/delete)"
```

---

## Task 7: Pare down `postgres.ts` to create-only

**Files:**
- Modify: `packages/api/src/routers/project/postgres.ts`
- Modify: `packages/api/src/routers/project/handlers.ts`

- [ ] **Step 1: Remove old `getPostgresResource`, `listPostgresResources`, `deletePostgresResource` exports**

In `packages/api/src/routers/project/postgres.ts`, delete the three functions starting at lines 201-296 (`getPostgresResource`, `listPostgresResources`, `deletePostgresResource`). Only `createPostgresResource` remains. Also remove unused imports left behind (e.g., `deleteProxyRoutesByResource`, `destroySwarmPostgres`, `db`, `resource`, `eq` — only if no other ref in this file).

After: `postgres.ts` should be ~200 lines, containing only `createPostgresResource` plus the imports it actually needs.

- [ ] **Step 2: Update handlers barrel**

Modify `packages/api/src/routers/project/handlers.ts`. Replace the postgres block:

```ts
export {
  createPostgresResource,
  deletePostgresResource,
  getPostgresResource,
  listPostgresResources,
} from "./postgres";
```

with:

```ts
export { createPostgresResource } from "./postgres";

export {
  deleteProjectResource,
  getProjectResource,
  listProjectResources,
  type ProjectResource,
} from "./resources";
```

- [ ] **Step 3: Verify type compiles**

Run: `bun tsc --noEmit -p packages/api`
Expected: errors only in `packages/api/src/routers/project/index.ts` (handlers used by old router code). Fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routers/project/postgres.ts packages/api/src/routers/project/handlers.ts
git commit -m "refactor(api): trim postgres.ts to create-only; expose resource handlers"
```

---

## Task 8: Wire new router namespace, drop old database.postgres reads

**Files:**
- Modify: `packages/api/src/routers/project/index.ts`

- [ ] **Step 1: Update imports**

In `packages/api/src/routers/project/index.ts`, replace the handlers import:

```ts
import {
  createPostgresResource,
  createProject,
  deletePostgresResource,
  deleteProject,
  getPostgresResource,
  getProject,
  getProjectBySlugForOrg,
  listPostgresResources,
  listProjectProxyRoutes,
  listProjects,
  updateProject,
} from "./handlers";
```

with:

```ts
import {
  createPostgresResource,
  createProject,
  deleteProject,
  deleteProjectResource,
  getProject,
  getProjectBySlugForOrg,
  getProjectResource,
  listProjectProxyRoutes,
  listProjectResources,
  listProjects,
  updateProject,
} from "./handlers";
```

- [ ] **Step 2: Replace the old `database: { postgres: { ... } }` block with new `resource` block**

In `index.ts`, delete the entire `database: { postgres: { ... } }` block (starts around line 120, ends with the matching `}`). Replace with:

```ts
  resource: {
    list: orgScopedProcedure.project.resource.list.handler(
      async ({ input, context, errors }) => {
        const result = await listProjectResources({
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            ProjectNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),

    get: orgScopedProcedure.project.resource.get.handler(
      async ({ input, context, errors }) => {
        const result = await getProjectResource({
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),

    delete: orgScopedProcedure.project.resource.delete.handler(
      async ({ input, context, errors }) => {
        const result = await deleteProjectResource(
          {
            projectId: input.projectId,
            resourceId: input.resourceId,
            organizationId: context.activeOrganizationId,
          },
          context.log,
        );
        if (result.isErr()) {
          throw matchError(result.error, {
            PostgresResourceNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),

    database: {
      postgres: {
        create: orgScopedProcedure.project.resource.database.postgres.create.handler(
          async ({ input, context, errors }) => {
            const result = await createPostgresResource(
              {
                ...input,
                projectId: input.projectId,
                organizationId: context.activeOrganizationId,
              },
              context.log,
            );
            if (result.isErr()) {
              throw matchError(result.error, {
                ProjectNotFoundError: () => errors.NOT_FOUND(),
                PostgresResourceConflictError: () => errors.CONFLICT(),
              });
            }
            return result.value;
          },
        ),
      },
    },
  },
```

- [ ] **Step 3: Verify type compiles**

Run: `bun tsc --noEmit -p packages/api`
Expected: zero errors in `packages/api`. (Frontend errors are fixed in Tasks 10-13.)

- [ ] **Step 4: Run existing tests**

Run: `cd packages/api && bun test`
Expected: All existing tests still pass. (Type errors in `apps/web-demo` are expected and ignored — web-demo is dead code.)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/project/index.ts
git commit -m "feat(api): expose project.resource.* namespace, drop database.postgres reads"
```

---

## Task 9: Frontend resource collection (main web app)

**Files:**
- Create: `apps/web/src/features/projects/data/resource.ts`

- [ ] **Step 1: Implement the resource collection**

Create `apps/web/src/features/projects/data/resource.ts`:

```ts
import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";

import { orpc, queryClient } from "@/shared/server/orpc";

/**
 * All resources (databases + services + …) for the active project. Sourced
 * from `project.resource.list` which returns a discriminated union over
 * `type`. The collection is per-project — caller supplies `projectId`.
 */
export function createResourceCollection(projectId: string) {
  return createCollection(
    queryCollectionOptions({
      ...orpc.project.resource.list.queryOptions({ input: { projectId } }),
      queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
      queryFn: async () => orpc.project.resource.list.call({ projectId }),
      onDelete: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((m) =>
            orpc.project.resource.delete.call({
              projectId,
              resourceId: m.original.resourceId,
            }),
          ),
        );
      },
      queryClient,
      getKey: (item) => item.resourceId,
    }),
  );
}
```

- [ ] **Step 2: Verify type compiles**

Run: `bun tsc --noEmit -p apps/web`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/projects/data/resource.ts
git commit -m "feat(web): add per-project resourceCollection backed by project.resource.list"
```

---

## Task 10: Wire layout to use resourceCollection for counts

**Files:**
- Modify: `apps/web/src/routes/_app/$orgSlug/$projectSlug/layout.tsx`

- [ ] **Step 1: Update the layout to preload + derive counts**

Replace the body of `apps/web/src/routes/_app/$orgSlug/$projectSlug/layout.tsx` (everything currently in the file) with:

```tsx
import { ID_PREFIX, zSlug } from "@otterstack/shared/id";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { useMemo } from "react";
import * as z from "zod";

import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import { createResourceCollection } from "@/features/projects/data/resource";
import { ProjectSidebar } from "@/features/shell/components/sidebar/project-sidebar";
import { SidebarInset } from "@/shared/components/ui/sidebar";

const zProjectSlugParam = z.object({
  projectSlug: zSlug(ID_PREFIX.project),
});
const zEnvSearch = z.object({ env: z.string().optional() });

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug")({
  component: RouteComponent,
  validateSearch: zEnvSearch,
  params: { parse: zProjectSlugParam.parse },
  loader: async ({ params }) => {
    await Promise.all([projectCollection.preload(), envCollection.preload()]);
    const project = projectCollection.toArray.find(
      (p) => p.slug === params.projectSlug,
    );
    if (!project) throw notFound();
    // Preload resources for the resolved projectId so the sidebar is ready.
    await createResourceCollection(project.id).preload();
    return { crumb: project.name };
  },
});

function RouteComponent() {
  const { user } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  const { env } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: project } = useLiveQuery(
    (q) =>
      q
        .from({ p: projectCollection })
        .where(({ p }) => eq(p.slug, projectSlug))
        .findOne(),
    [projectSlug],
  );

  const resourceCollection = useMemo(
    () => (project ? createResourceCollection(project.id) : null),
    [project?.id],
  );

  const { data: resources = [] } = useLiveQuery(
    (q) =>
      resourceCollection
        ? q.from({ r: resourceCollection })
        : q.from({ r: projectCollection }).where(() => false),
    [resourceCollection],
  );

  const { data: environments = [] } = useLiveQuery(
    (q) =>
      q
        .from({ e: envCollection })
        .where(({ e }) => eq(e.projectId, project?.id ?? "")),
    [project?.id],
  );

  if (!project) return null;

  const databases = resources.filter((r) => r.type === "database");
  // routes will come from a routeCollection in a follow-up; zero for now.
  const routes: never[] = [];

  const defaultEnv =
    environments.find((e) => e.slug === "production") ?? environments[0];
  const envSlug = env ?? defaultEnv?.slug;

  return (
    <>
      <ProjectSidebar
        collapsible="icon"
        user={user}
        project={{
          ...project,
          databases: databases.length,
          routes: routes.length,
          environments,
        }}
        envSlug={envSlug}
        onEnvSlugChange={(slug) =>
          navigate({ search: (prev) => ({ ...prev, env: slug }) })
        }
      />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </>
  );
}
```

Why the `useMemo` dance: `createResourceCollection` is a factory per `projectId` (resource list is parameterized). Caching by `project.id` avoids rebuilding the collection on every render.

- [ ] **Step 2: Verify type compiles**

Run: `bun tsc --noEmit -p apps/web`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_app/$orgSlug/$projectSlug/layout.tsx
git commit -m "feat(web): derive sidebar database counts from resourceCollection"
```

---

## Task 11: Update `project-card.tsx` to use real database counts

**Files:**
- Modify: `apps/web/src/features/projects/components/project-card.tsx`
- Modify: `apps/web/src/features/projects/components/project-list.tsx` (if it passes `databaseCount`)

- [ ] **Step 1: Open the card to see the current shape**

Read `apps/web/src/features/projects/components/project-card.tsx` and confirm `databaseCount?: number` is on the props type and consumed via `project.databaseCount ?? 0`. The list parent (`project-list.tsx`) similarly passes it through.

- [ ] **Step 2: Pull counts from the resource collection**

The org dashboard (`apps/web/src/routes/_app/$orgSlug/index.tsx`) currently passes raw `projectCollection` rows to `<ProjectList>`. Project rows have no `databaseCount`. Two options:

**(A) Fetch resources lazily per card.** Each `<ProjectCard>` calls `createResourceCollection(project.id).preload()` on mount. Heavier — N collections for N projects.

**(B) Add an aggregate endpoint.** New `project.list` enriched with `databaseCount`/`routeCount` from a `LEFT JOIN ... COUNT(*) GROUP BY project.id`. Cheapest. Recommended.

For this task pick **B**. Apply server-side. Implement:

1. In `packages/api/src/routers/project/queries/project.ts`, change `listProjectRecordsByOrg` to:

```ts
import { resource } from "@otterstack/db/schema/project";
import { count, eq, sql } from "drizzle-orm";

export async function listProjectRecordsByOrg(organizationId: OrgId) {
  return db
    .select({
      id: project.id,
      name: project.name,
      slug: project.slug,
      environmentId: project.environmentId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      databaseCount: sql<number>`coalesce(sum(case when ${resource.type} = 'database' then 1 else 0 end), 0)::int`,
    })
    .from(project)
    .leftJoin(resource, eq(resource.projectId, project.id))
    .where(eq(project.organizationId, organizationId))
    .groupBy(project.id);
}
```

2. In `packages/api/src/routers/project/contract.ts`, change `list` output to include the count:

```ts
const projectListItemSchema = projectSchema.extend({
  databaseCount: z.number().int().nonnegative(),
});

// inside projectContract:
list: oc
  .meta({ path: basePath, tag, method: "GET" })
  .output(z.array(projectListItemSchema)),
```

3. The frontend `projectCollection` type widens automatically since it derives from the contract. `project-card.tsx` consumes `project.databaseCount` — it now has real data.

- [ ] **Step 3: Push schema-free DB change (none required — pure query change)**

Skip — this task touches no DB schema.

- [ ] **Step 4: Verify type compiles + tests still pass**

Run: `bun tsc --noEmit && cd packages/api && bun test`
Expected: zero errors; existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/project/queries/project.ts packages/api/src/routers/project/contract.ts
git commit -m "feat(api): enrich project.list with databaseCount aggregate"
```

---

## Task 12: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev stack**

Run: `bun dev`
Expected: API + web boot; no startup errors.

- [ ] **Step 2: Sign in and open the dashboard**

Browse to the dashboard URL. Confirm projects load. If any pre-existing postgres resource exists in dev, confirm the card shows the correct `databaseCount`.

- [ ] **Step 3: Open a project's sidebar**

Click into a project. Confirm the sidebar renders, the environment switcher works, and the databases badge (currently `databases: N` derived from the collection) matches the number of postgres resources you have.

- [ ] **Step 4: Create a database via web-demo, then delete it**

In the web-demo app, create a Postgres resource, confirm it appears in the list (calls `project.resource.list`), open it (`project.resource.get`), and delete it (`project.resource.delete`). Confirm Swarm service is gone via `docker service ls`.

- [ ] **Step 5: Confirm no refetch on navigation**

In the main web app, navigate between `/$orgSlug` and `/$orgSlug/$projectSlug` repeatedly. Confirm DevTools Network panel shows no new `resources` or `projects` requests after the first load (within the queryClient's default staleTime).

- [ ] **Step 6: Commit final cleanup if anything moved**

```bash
git status
# If clean, no-op. Otherwise stage and commit fix-forward changes.
```

---

## Out of scope (separate plans)

- Adding **MySQL/MariaDB/Mongo/Redis/ClickHouse** engines. Each is its own plan: new entry in `DATABASE_ENGINES`, new entry in `databaseEngineEnum` (+ migration), new `MysqlProvisioner` (or whatever), new entry in `databaseResourceSchema` discriminator, new `resource.database.{engine}.create` contract endpoint, new handler. Frontend doesn't change.
- **Service resources** (already has table, no contract surface). When this lands: extend `resourceSchema` discriminator with `serviceResourceSchema`, add `ServiceProvisioner` interface (probably parallel to `DatabaseProvisioner`), add `resource.service.docker.create`.
- **`category` grouping in the engine picker UI** (relational/kv/document/analytical). Add when the picker ships.
- **Route counts in sidebar.** Mirror Task 12 with a `routeCount` aggregate on `project.list`, or a `routeCollection`.

---

## Self-review notes

- Every spec area from the architecture discussion is covered: schema (Task 1), engine catalog (Task 2), provisioner abstraction (Task 4), discriminated contract (Task 5), generic handlers (Task 6), router wiring (Task 8), frontend collection (Task 9), real counts (Tasks 10-11).
- Postgres-specific create endpoint is preserved under the new `resource.database.postgres.create` path — engine-specific inputs stay engine-specific.
- The `resourceSchema = z.discriminatedUnion("type", [...])` collapses to one variant today; the shape is forward-compatible.
- `databaseEngineEnum` in the DB schema only has `"postgres"` and is not touched here — adding engines later requires a one-line schema change + migration; intentionally out of scope.
- Type-consistency check: `ProjectResource` (new) = `PostgresResource` today; widens when more engines land. `mapDatabaseResource` already returns `{type: "database", engine: "postgres", ...}` so it slots into the union with no shape change.
