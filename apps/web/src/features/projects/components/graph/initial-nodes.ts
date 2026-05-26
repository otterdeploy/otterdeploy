// Single source of truth for the graph's demo nodes / edges. Imported by
// both the canvas (graph/layout.tsx) and the detail panel ($resourceId.tsx)
// so a clicked node always has data to render — even when no real DB
// resource exists yet (services + workers are demo-only right now).

import {
  CodeIcon,
  Database02Icon,
  FlashIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import type { Edge, Node } from "@xyflow/react";

import type { ResourceNodeData } from "./resource-node";

// Horizontal flow: 4 tiers left → right. Cards are 420px wide; allow ~120px
// between tiers so the smoothstep edge "elbow" has room to turn. Rows inside
// a tier are spaced 240px apart (tall enough for cards carrying volume trays).
//
//   tier 0   tier 1                tier 2              tier 3
//   web  →   imgproxy              postgres            mysql
//            api          ────────►redis     ──────────►mariadb
//            worker                mongo
//            cron
//            vector-bridge
export const TIER_X = [0, 540, 1080, 1620] as const;
const ROW_Y = (i: number) => i * 240;

export const INITIAL_NODES: Node<ResourceNodeData>[] = [
  // Tier 1 — services. Ordered top-to-bottom so the edges into Tier 2
  // (postgres / redis / mongo) leave the box in roughly the same y-range
  // as their target.
  //   row 0: imgproxy (terminal)
  //   row 1: api      → postgres, redis, mongo
  //   row 2: worker   → redis, postgres, mongo, mysql, mariadb
  //   row 3: cron     → postgres, mongo
  //   row 4: vector-bridge → mongo
  {
    id: "api",
    type: "resource",
    position: { x: TIER_X[1], y: ROW_Y(1) },
    data: {
      kind: "service",
      name: "api",
      description:
        "Public-facing API for the web client. Handles auth, oRPC routes, and Inngest triggers.",
      status: "running",
      tech: { label: "Bun 1.3", icon: FlashIcon },
      git: {
        commit: "a3f8b2c4e",
        message: "fix(api): handle CORS preflight for *.helio.so",
        branch: "main",
      },
      replicas: [
        { label: "api.1", status: "running" },
        { label: "api.2", status: "running" },
        { label: "api.3", status: "running" },
      ],
    },
  },
  {
    id: "worker",
    type: "resource",
    position: { x: TIER_X[1], y: ROW_Y(2) },
    data: {
      kind: "service",
      name: "worker",
      description: "Background job runner. Processes Inngest events and long-running tasks.",
      status: "building",
      tech: { label: "Node 22", icon: CodeIcon },
      git: {
        commit: "8b1e9d401",
        message: "feat(worker): batch outbound webhooks per tenant",
        branch: "main",
      },
      replicas: [
        { label: "worker.1", status: "running" },
        { label: "worker.2", status: "building" },
      ],
    },
  },
  {
    id: "imgproxy",
    type: "resource",
    position: { x: TIER_X[1], y: ROW_Y(0) },
    data: {
      kind: "service",
      name: "imgproxy",
      description: "Image resizing and optimization proxy. Cached at the edge.",
      status: "error",
      tech: { label: "Go 1.23", icon: ServerStack01Icon },
      git: {
        commit: "c2a5f019d",
        message: "perf(imgproxy): pre-warm WebP encoder pool on boot",
        branch: "main",
      },
      replicas: [
        { label: "imgproxy.1", status: "running" },
        { label: "imgproxy.2", status: "error" },
      ],
    },
  },

  // Tier 0 — single entry-point service. Sits opposite the api row so the
  // web → api edge runs flat.
  {
    id: "web",
    type: "resource",
    position: { x: TIER_X[0], y: ROW_Y(1) },
    data: {
      kind: "service",
      name: "web",
      description: "Marketing site and dashboard shell. SSR via TanStack Start.",
      tech: { label: "Bun 1.3", icon: FlashIcon },
      git: {
        commit: "f7c3a911e",
        message: "refactor(web): drop os-* classes in favor of shadcn primitives",
        branch: "main",
      },
      replicas: [
        { label: "web.1", status: "running" },
        { label: "web.2", status: "running" },
        { label: "web.3", status: "running" },
      ],
    },
  },
  {
    id: "cron",
    type: "resource",
    position: { x: TIER_X[1], y: ROW_Y(3) },
    data: {
      kind: "service",
      name: "nightly-cleanup",
      description: "Sweeps stale uploads and rotates audit logs every night at 03:00 UTC.",
      status: "running",
      git: {
        commit: "5d6f8b210",
        message: "chore(cron): rotate audit-log retention to 90 days",
        branch: "main",
      },
    },
  },
  {
    id: "docker-custom",
    type: "resource",
    position: { x: TIER_X[1], y: ROW_Y(4) },
    data: {
      kind: "service",
      name: "vector-bridge",
      engine: "docker",
      description:
        "Custom Docker image — pulls vectors from upstream and writes to the search index.",
      status: "running",
      tech: { label: "Custom OCI image" },
    },
  },

  // Tier 2 — primary datastores. Centered vertically against the service
  // tier so api/worker/cron edges run roughly horizontal.
  //   row 1: postgres   ← api, worker, cron
  //   row 2: redis      ← api, worker
  //   row 3: mongo      ← api, worker, cron, vector-bridge
  {
    id: "postgres",
    type: "resource",
    position: { x: TIER_X[2], y: ROW_Y(1) },
    data: {
      kind: "database",
      name: "postgres",
      engine: "postgres",
      description: "Primary application database. Schema managed via Drizzle migrations.",
      status: "running",
      tech: { label: "Postgres 16", icon: Database02Icon },
      volumes: [{ name: "pgdata", size: "50 GB", mount: "/var/lib/postgresql/data" }],
    },
  },
  {
    id: "redis",
    type: "resource",
    position: { x: TIER_X[2], y: ROW_Y(2) },
    data: {
      kind: "database",
      name: "redis",
      engine: "redis",
      description: "Session cache, rate-limit counters, and Inngest queue backing store.",
      status: "building",
      tech: { label: "Redis 7.4", icon: Database02Icon },
      volumes: [{ name: "redis-aof", size: "5 GB", mount: "/data" }],
    },
  },
  // Inline Mounts grid — 3 mounts, so they lay out in 2 columns.
  {
    id: "mongo",
    type: "resource",
    position: { x: TIER_X[2], y: ROW_Y(3) },
    data: {
      kind: "database",
      name: "events",
      engine: "mongodb",
      description: "Event log store — append-only, replicated across two regions.",
      status: "error",
      tech: { label: "MongoDB 7.0", icon: Database02Icon },
      volumes: [
        { name: "events-data", size: "200 GB" },
        { name: "events-wal", size: "50 GB" },
        { name: "events-backup", size: "1 TB" },
      ],
    },
  },

  // Tier 3 — legacy / analytics datastores. Only the worker touches these.
  {
    id: "mysql",
    type: "resource",
    position: { x: TIER_X[3], y: ROW_Y(2) },
    data: {
      kind: "database",
      name: "legacy",
      engine: "mysql",
      description: "Legacy MySQL replica kept around for the importer until the cutover.",
      status: "running",
      tech: { label: "MySQL 8.4", icon: Database02Icon },
    },
  },
  {
    id: "mariadb",
    type: "resource",
    position: { x: TIER_X[3], y: ROW_Y(3) },
    data: {
      kind: "database",
      name: "analytics",
      engine: "mariadb",
      description: "Analytics warehouse — column store with daily rollups.",
      tech: { label: "MariaDB 11.4", icon: Database02Icon },
    },
  },
];

/**
 * Edges model real traffic flow inside the project. Caddy (the edge proxy)
 * is platform infrastructure, not a user resource — it doesn't appear as a
 * node. "This service is public" is a property of the service itself
 * (rendered on the service's detail panel as Public URL).
 *
 *   web ──► api ──► postgres, redis, mongo
 *       ──► imgproxy
 *           api ◄── worker (queue consumer)
 *
 *   worker ──► postgres, mongo, legacy mysql (importer), mariadb analytics
 *   cron   ──► postgres (cleanup), mongo (log rotation)
 *   vector-bridge ──► mongo (event sink)
 *
 * `animated: true` is reserved for live request-path edges so the operator
 * can spot hot loops at a glance. Scheduled / batch flows (cron, ETL,
 * legacy importer) stay static.
 */
export const INITIAL_EDGES: Edge[] = [
  // ─── Web tier → backend / images ────────────────────────────────────
  { id: "web-api", source: "web", target: "api", animated: true },
  { id: "web-imgproxy", source: "web", target: "imgproxy", animated: true },

  // ─── API → datastores ───────────────────────────────────────────────
  { id: "api-postgres", source: "api", target: "postgres", animated: true },
  { id: "api-redis", source: "api", target: "redis", animated: true },
  { id: "api-mongo", source: "api", target: "mongo" },

  // ─── Worker (queue consumer) → datastores ───────────────────────────
  { id: "worker-redis", source: "worker", target: "redis", animated: true },
  { id: "worker-postgres", source: "worker", target: "postgres" },
  { id: "worker-mongo", source: "worker", target: "mongo" },
  // Legacy importer — only the worker touches the MySQL replica, not the
  // live API path. Stays static (runs intermittently).
  { id: "worker-mysql", source: "worker", target: "mysql" },
  // Nightly ETL into the analytics warehouse.
  { id: "worker-mariadb", source: "worker", target: "mariadb" },

  // ─── Scheduled / batch ──────────────────────────────────────────────
  { id: "cron-postgres", source: "cron", target: "postgres" },
  { id: "cron-mongo", source: "cron", target: "mongo" },

  // ─── Custom Docker image (vector-bridge) → event store ──────────────
  { id: "vector-mongo", source: "docker-custom", target: "mongo" },
];

export const INITIAL_NODES_BY_ID: Record<string, Node<ResourceNodeData>> = Object.fromEntries(
  INITIAL_NODES.map((node) => [node.id, node]),
);
