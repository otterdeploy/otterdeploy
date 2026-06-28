/**
 * Resource-Based Invalidation Design
 * ====================================
 *
 * Instead of broadcasting exact query keys, mutations declare which
 * "resources" they affect. Clients subscribe to resources they're
 * displaying. The server broadcasts resource-level invalidation.
 *
 * This handles cross-entity invalidation naturally:
 *   - deleteProject invalidates ["project", "env", "deployment"]
 *   - client showing env list is subscribed to "env" → gets notified
 *
 * Flow:
 *   1. Query endpoints declare: I provide resource "env"
 *   2. Mutation endpoints declare: I invalidate resources ["env", "project"]
 *   3. Client subscribes to resources it's actively querying
 *   4. After mutation, server broadcasts affected resources
 *   5. Subscribed clients refetch their queries
 */

// ─── Resource Registry ──────────────────────────────────────────────

/**
 * All resources in the system. Single source of truth.
 * Adding a new entity? Add it here first.
 */
const resources = ["project", "env", "service", "deployment", "team", "audit"] as const;

type Resource = (typeof resources)[number];

// ─── Metadata on Procedures ─────────────────────────────────────────

/**
 * Every procedure gets metadata describing its resource relationships.
 *
 * Queries declare what they `provide`.
 * Mutations declare what they `invalidate`.
 */
export interface ProcedureMeta {
  /** The resource this query provides data for */
  resource?: Resource;
  /** Resources this mutation will invalidate */
  invalidates?: Resource[];
}

// ─── Example: declaring meta on procedures ──────────────────────────

/**
 * Queries declare what they `provide`; mutations declare what they
 * `invalidate`. Example metadata for a project router:
 */
export const exampleProcedureMeta = {
  listEnv: { resource: "env" },
  getProject: { resource: "project" },
  deleteProject: { invalidates: ["project", "env", "deployment"] },
} satisfies Record<string, ProcedureMeta>;

// ─── Server-side Middleware (automatic broadcast) ───────────────────

/** Mutation context exposes a broadcaster for invalidated resources. */
interface BroadcastContext {
  broadcast(resources: Resource[]): void;
}

/** Procedure shape carrying oRPC metadata. */
interface MetaProcedure {
  "~orpc"?: { meta?: ProcedureMeta };
}

/** Options handed to an oRPC-style middleware. */
interface MiddlewareOptions<TContext extends BroadcastContext> {
  context: TContext;
  next: (options: { context: TContext }) => Promise<unknown>;
  procedure: MetaProcedure;
}

/**
 * Instead of manually calling context.broadcast() in every handler,
 * an oRPC middleware reads the procedure's meta.invalidates and
 * broadcasts automatically after a successful mutation.
 *
 * This means handlers stay clean — no broadcast calls needed.
 */
export const autoBroadcastMiddleware = /* o.middleware */ async <
  TContext extends BroadcastContext,
>({
  context,
  next,
  procedure,
}: MiddlewareOptions<TContext>): Promise<unknown> => {
  const result = await next({ context });

  const meta: ProcedureMeta | undefined = procedure["~orpc"]?.meta;
  if (meta?.invalidates?.length) {
    context.broadcast(meta.invalidates);
  }

  return result;
};

// ─── Invalidation Broadcaster (server) ──────────────────────────────

/**
 * Clients subscribe to resources, not query keys.
 * Server maps: resource → set of WebSocket clients.
 *
 * When a mutation invalidates ["env", "project"], all clients
 * subscribed to either "env" or "project" get notified.
 */
export interface InvalidationBroadcaster {
  /** Client sends: { type: "subscribe", resources: ["env", "project"] } */
  onMessage(ws: unknown, data: string): void;
  removeClient(ws: unknown): void;
  /** Called by middleware with the list of affected resources */
  broadcast(resources: Resource[]): void;
}

// ─── Client Hook (subscribe by resource) ────────────────────────────

/**
 * Usage in components:
 *
 *   // In the env list page
 *   useResourceInvalidation("env");
 *
 *   // In the project dashboard (cares about multiple resources)
 *   useResourceInvalidation(["project", "env", "deployment"]);
 *
 * When the server broadcasts that "env" changed, every component
 * subscribed to "env" will have its queries invalidated.
 *
 * The hook maps resources back to TanStack Query keys for invalidation.
 * This mapping can be convention-based (resource name = first query key segment)
 * or explicit via a registry.
 */
export type UseResourceInvalidation = (resources: Resource[]) => void;

// ─── Summary ────────────────────────────────────────────────────────

/**
 * What this gives you:
 *
 * 1. DECLARATIVE — mutation metadata says what it affects, no manual broadcast
 * 2. CROSS-ENTITY — deleteProject invalidates envs, deployments automatically
 * 3. EFFICIENT — clients only get notified for resources they're viewing
 * 4. DISCOVERABLE — look at any procedure's meta to see its blast radius
 * 5. MIDDLEWARE-DRIVEN — broadcast happens automatically, handlers stay clean
 *
 * What's needed to implement:
 *
 * 1. ProcedureMeta type (above)
 * 2. Auto-broadcast middleware (reads meta, calls broadcast)
 * 3. Resource-based subscription map (replaces current query-key-based map)
 * 4. useResourceInvalidation hook (replaces useInvalidationSocket)
 * 5. Convention: query key prefix = resource name (e.g. ["env", ...])
 */
