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

// Layout: 3 columns × 4 rows. Cards are 420px wide; allow ~60px gap horizontally.
// Row 3 (databases with MOUNTS trays) sits taller so it gets extra vertical room.
export const COL = [0, 480, 960] as const;
export const ROW = [0, 280, 600, 940] as const;

export const INITIAL_NODES: Node<ResourceNodeData>[] = [
  // Row 1 — services, three statuses
  {
    id: "api",
    type: "resource",
    position: { x: COL[0], y: ROW[0] },
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
    position: { x: COL[1], y: ROW[0] },
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
    position: { x: COL[2], y: ROW[0] },
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

  // Row 2 — service without status, service without tech footer
  {
    id: "web",
    type: "resource",
    position: { x: COL[0], y: ROW[1] },
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
    position: { x: COL[1], y: ROW[1] },
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
    position: { x: COL[2], y: ROW[1] },
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

  // Row 3 — databases with brand engines, three statuses + 3 volume variants
  // Variant A (inline): postgres carries its volumes inside the card body.
  {
    id: "postgres",
    type: "resource",
    position: { x: COL[0], y: ROW[2] },
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
    position: { x: COL[1], y: ROW[2] },
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
    position: { x: COL[2], y: ROW[2] },
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

  // Row 4 — extra engines + a route
  {
    id: "mysql",
    type: "resource",
    position: { x: COL[0], y: ROW[3] },
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
    position: { x: COL[1], y: ROW[3] },
    data: {
      kind: "database",
      name: "analytics",
      engine: "mariadb",
      description: "Analytics warehouse — column store with daily rollups.",
      tech: { label: "MariaDB 11.4", icon: Database02Icon },
    },
  },
  {
    id: "route-public",
    type: "resource",
    position: { x: COL[2], y: ROW[3] },
    data: {
      kind: "route",
      name: "helio.so",
      description:
        "Caddy edge proxy — fans out by Host header. helio.so → web · api.helio.so → api · img.helio.so → imgproxy. TLS auto-renewed via Let's Encrypt.",
      status: "running",
    },
  },
];

/**
 * Edges model real traffic flow:
 *
 *   route ──► web ──► api ──► postgres, redis, mongo
 *        ──► api          ◄── worker (queue consumer)
 *        ──► imgproxy ◄── web
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
  // ─── Public ingress (Caddy edge → public services) ──────────────────
  { id: "route-web", source: "route-public", target: "web", animated: true },
  { id: "route-api", source: "route-public", target: "api", animated: true },
  {
    id: "route-imgproxy",
    source: "route-public",
    target: "imgproxy",
    animated: true,
  },

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
