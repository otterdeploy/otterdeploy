# Zero Migration Design: Core CRUD Reads + Writes

## Scope

**Tables moving to Zero (reads + writes):**
- `project` — CRUD + list by org
- `projectEnvironment` — CRUD + list by project
- `projectResource` — CRUD + list by environment
- `projectResourceLink` — CRUD + list by environment
- `projectViewport` — read/upsert per environment

**Read-only via Zero:**
- `deployment` + `deploymentEvent` — list by project/resource (creation/cancel/rollback stays oRPC)

**Staying on oRPC:**
- Deployment orchestration (create, cancel, rollback, streamLogs)
- Environment variables (secrets, step-up auth)
- Domains, servers, backups, audit, git providers, monitoring, system

**Architecture graph:** Client composes from reactive `projectResource` + `projectResourceLink` + `projectViewport` Zero subscriptions. `replaceGraph` and `updateViewport` become Zero mutators.

## Queries

### Existing (in packages/zero/src/queries.ts)
- `projectList(organizationId)`, `projectById(projectId)`
- `environmentList(projectId)`, `resourceList(environmentId)`
- `resourceLinkList(environmentId)`, `viewport(environmentId)`
- `deploymentListForProject(projectId)`, `deploymentListForResource(resourceId)`

### New
- `resourceById(resourceId)` — service detail page

### Client usage
```tsx
const [projects] = useQuery(queries.projectList({ organizationId }));
```

## Mutators

| Mutator | Client | Server |
|---------|--------|--------|
| `project.create` | Optimistic insert | Validate org membership, generate slug |
| `project.update` | Optimistic update | Validate ownership, slug uniqueness |
| `project.delete` | Optimistic delete | Validate owner role, cascade cleanup |
| `environment.create` | Optimistic insert | Validate project membership |
| `environment.delete` | Optimistic delete | Validate admin role, cascade |
| `resource.create` | Optimistic insert | Validate env membership, set defaults |
| `resource.update` | Optimistic update | Validate membership |
| `resource.delete` | Optimistic delete | Validate admin role |
| `resourceLink.create` | Optimistic insert | Validate both resources exist |
| `resourceLink.delete` | Optimistic delete | Validate membership |
| `architecture.updateViewport` | Optimistic upsert | Validate membership |
| `architecture.replaceGraph` | Optimistic batch update | Validate membership, positions |

Client mutation pattern:
```tsx
zero.mutate.project.create({ organizationId, name, slug });
```

## Route Changes

1. **`projects/index.tsx`** — Zero subscriptions for project/resource/env lists. Zero mutator for project.create.
2. **`projects/$projectId/layout.tsx`** — Zero subscriptions for project, envs, projects list. Zero mutators for environment.create, resource.create.
3. **`projects/$projectId/index.tsx`** — Zero subscriptions for envs, resources, links (compose graph client-side).
4. **`projects/$projectId/service/$serviceId.tsx`** — Zero query for resource by ID.

## What Gets Removed

- Route `loader` functions that prefetch via oRPC for migrated entities
- `queryClient.ensureQueryData` / `queryClient.invalidateQueries` calls for migrated entities
- `apps/web/src/utils/zero.ts` (redundant singleton)
- oRPC query options imports for migrated entities

## Server Endpoints

`POST /api/zero/query` and `POST /api/zero/mutate` on the Hono server, using `handleQueryRequest` / `handleMutateRequest` from `@rocicorp/zero/server` with the `zeroNodePg` adapter. Server mutators call domain services for business logic.
